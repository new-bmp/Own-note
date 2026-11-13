import http from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { toolchainPaths, executionEnv } from './toolchains.mjs'

const maxCode = 200000
const maxBody = 2 * 1024 * 1024
const maxResponse = 4 * 1024 * 1024
const idPattern = /^[a-zA-Z0-9_-]{1,128}$/
const pathPattern = /^\/(?:[^\u0000-\u001f\u007f]){0,4000}$/

// The embedded Python runtime is intentionally standard-library-only. This
// compatibility layer lets the common Flask teaching pattern run offline;
// when a real Flask installation is available it is never shadowed.
const flaskCompat = String.raw`from wsgiref.simple_server import make_server
from urllib.parse import parse_qs, urlsplit
from contextvars import ContextVar
import json as _json
import os as _os
import re as _re

_current_request = ContextVar("own_flask_request", default=None)

class _Proxy:
    def __init__(self, source): self._source = source
    def __getattr__(self, name):
        value = self._source.get()
        if value is None: raise RuntimeError("working outside of request context")
        return getattr(value, name)
    def __getitem__(self, key): return getattr(self, "__getattr__")(key)

class _MultiDict(dict):
    def get(self, key, default=None, type=None):
        value = super().get(key, default)
        if type is not None and value is not default:
            try: return type(value)
            except (TypeError, ValueError): return default
        return value
    def to_dict(self, flat=True): return dict(self)

class _Request:
    def __init__(self, environ):
        self.environ = environ
        self.method = environ.get("REQUEST_METHOD", "GET")
        self.path = environ.get("PATH_INFO", "/")
        self.url = self.path
        self.headers = {key[5:].replace("_", "-").title(): value for key, value in environ.items() if key.startswith("HTTP_")}
        if environ.get("CONTENT_TYPE"): self.headers["Content-Type"] = environ["CONTENT_TYPE"]
        self.args = _MultiDict((key, values[-1] if values else "") for key, values in parse_qs(environ.get("QUERY_STRING", ""), keep_blank_values=True).items())
        length = int(environ.get("CONTENT_LENGTH") or 0)
        self.data = environ["wsgi.input"].read(length) if length else b""
        self.form = _MultiDict()
        if "application/x-www-form-urlencoded" in self.headers.get("Content-Type", ""):
            self.form.update((key, values[-1] if values else "") for key, values in parse_qs(self.data.decode("utf-8", "replace"), keep_blank_values=True).items())
    def get_json(self, silent=False, force=False, **kwargs):
        try:
            if not force and "json" not in self.headers.get("Content-Type", "").lower(): return None
            return _json.loads(self.data.decode("utf-8")) if self.data else None
        except Exception:
            if silent: return None
            raise

request = _Proxy(_current_request)

class Response:
    def __init__(self, response="", status=200, headers=None, mimetype=None, content_type=None):
        self.status_code = int(status)
        self.headers = dict(headers or {})
        if content_type: self.headers["Content-Type"] = content_type
        elif mimetype: self.headers["Content-Type"] = mimetype if "/" in mimetype else mimetype + "; charset=utf-8"
        self._body = response.encode("utf-8") if isinstance(response, str) else bytes(response)
    def get_data(self, as_text=False): return self._body.decode("utf-8", "replace") if as_text else self._body
    def __call__(self, environ, start_response):
        status_text = {200: "OK", 201: "CREATED", 302: "FOUND", 400: "BAD REQUEST", 404: "NOT FOUND", 500: "INTERNAL SERVER ERROR"}.get(self.status_code, "")
        headers = list(self.headers.items())
        if not any(key.lower() == "content-length" for key, _ in headers): headers.append(("Content-Length", str(len(self._body))))
        start_response(f"{self.status_code} {status_text}", headers)
        return [self._body]

def jsonify(*args, **kwargs):
    value = args[0] if len(args) == 1 and not kwargs else (kwargs if kwargs else list(args))
    return Response(_json.dumps(value, ensure_ascii=False), content_type="application/json; charset=utf-8")

def render_template_string(template, **context):
    result = str(template)
    for key, value in context.items(): result = result.replace("{{ " + key + " }}", str(value)).replace("{{" + key + "}}", str(value))
    return result

def redirect(location, code=302, **kwargs): return Response("", status=code, headers={"Location": location})

def send_file(filename, mimetype=None, **kwargs):
    with open(filename, "rb") as handle: return Response(handle.read(), mimetype=mimetype)

class Flask:
    def __init__(self, import_name, **kwargs): self.import_name = import_name; self._routes = []
    def route(self, rule, **options):
        methods = [method.upper() for method in options.pop("methods", ["GET"])]
        def decorator(function): self._routes.append((rule, methods, function)); return function
        return decorator
    def get(self, rule, **options): return self.route(rule, methods=["GET"], **options)
    def post(self, rule, **options): return self.route(rule, methods=["POST"], **options)
    def put(self, rule, **options): return self.route(rule, methods=["PUT"], **options)
    def delete(self, rule, **options): return self.route(rule, methods=["DELETE"], **options)
    def patch(self, rule, **options): return self.route(rule, methods=["PATCH"], **options)
    def _match(self, rule, path):
        pattern = _re.sub(r"<(?:(?:[^:>]+):)?([^>]+)>", r"(?P<\\1>[^/]+)", rule)
        match = _re.fullmatch(pattern, path)
        return match.groupdict() if match else None
    def wsgi_app(self, environ, start_response):
        path = environ.get("PATH_INFO", "/"); method = environ.get("REQUEST_METHOD", "GET")
        for rule, methods, function in self._routes:
            values = self._match(rule, path)
            if values is not None and method in methods:
                token = _current_request.set(_Request(environ))
                try:
                    value = function(**values)
                    if isinstance(value, Response): response = value
                    elif isinstance(value, tuple):
                        response = jsonify(value[0]) if isinstance(value[0], (dict, list)) else Response(value[0], status=value[1], headers=value[2] if len(value) > 2 else None)
                        response.status_code = value[1]
                        if len(value) > 2: response.headers.update(value[2])
                    elif isinstance(value, (dict, list)): response = jsonify(value)
                    else: response = Response("" if value is None else str(value), content_type="text/html; charset=utf-8")
                    return response(environ, start_response)
                except Exception as error:
                    return Response("<h1>500 Internal Server Error</h1><pre>" + str(error) + "</pre>", status=500, content_type="text/html; charset=utf-8")(environ, start_response)
                finally: _current_request.reset(token)
        return Response("<h1>404 Not Found</h1>", status=404, content_type="text/html; charset=utf-8")(environ, start_response)
    def __call__(self, environ, start_response): return self.wsgi_app(environ, start_response)
    def run(self, host=None, port=None, debug=False, **kwargs):
        server = make_server(host or _os.environ.get("OWN_APP_HOST", "127.0.0.1"), int(port or _os.environ.get("OWN_APP_PORT", "5000")), self)
        server.serve_forever()
`

function validId(value) { return typeof value === 'string' && idPattern.test(value) }
function validPath(value) { return typeof value === 'string' && pathPattern.test(value) }

function killTree(child) {
  if (!child || child.exitCode !== null) return
  if (process.platform === 'win32') spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill())
  else { try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') } }
}

async function freePort(preferred = 0) {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(preferred, '127.0.0.1', resolve)
  })
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

async function canImportFlask(command, cwd, env) {
  return new Promise(resolve => {
    const child = spawn(command, ['-c', 'import flask'], { cwd, env, windowsHide: true, stdio: 'ignore' })
    const timer = setTimeout(() => { killTree(child); resolve(false) }, 3000)
    child.once('error', () => { clearTimeout(timer); resolve(false) })
    child.once('exit', code => { clearTimeout(timer); resolve(code === 0) })
  })
}

function appendLog(app, stream, chunk) {
  const text = chunk.toString('utf8')
  app.logs.push(...text.split(/\r?\n/).filter(Boolean).map(line => ({ at: Date.now(), stream, text: line.slice(0, 4000) })))
  app.logs = app.logs.slice(-500)
  if (stream === 'stderr') app.error = text.trim().slice(-4000) || app.error
}

function view(app) {
  return {
    id: app.id,
    framework: app.framework,
    runtime: app.runtime,
    status: app.status,
    port: app.port,
    url: app.status === 'running' ? `/api/program/apps/${app.id}/proxy/` : undefined,
    startedAt: app.startedAt,
    finishedAt: app.finishedAt,
    requestCount: app.requestCount,
    error: app.error,
    logs: app.logs.slice(-100),
  }
}

function responseHeaders(headers) {
  const result = {}
  for (const [key, value] of Object.entries(headers || {})) if (value !== undefined) result[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value)
  return result
}

export function createProgramApps() {
  const apps = new Map()
  let closed = false

  async function stop(id) {
    const app = apps.get(id)
    if (!app) return { id, status: 'stopped' }
    apps.delete(id)
    app.status = 'stopped'
    killTree(app.child)
    await rm(app.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {})
    return view(app)
  }

  async function waitForPort(app) {
    const deadline = Date.now() + 7000
    while (Date.now() < deadline) {
      if (app.status === 'error' || app.child?.exitCode !== null) throw new Error(app.error || 'Flask 应用启动失败。')
      try {
        await new Promise((resolve, reject) => {
          const socket = net.createConnection({ host: '127.0.0.1', port: app.port })
          socket.once('connect', () => { socket.destroy(); resolve() })
          socket.once('error', reject)
        })
        return
      } catch { await new Promise(resolve => setTimeout(resolve, 80)) }
    }
    throw new Error('Flask 应用未在 7 秒内监听端口。')
  }

  async function start(input) {
    if (closed) throw new Error('服务正在关闭。')
    if (!input || input.framework !== 'flask' || input.language !== 'python') throw new Error('应用模式需要 Python Flask 单元。')
    if (!validId(input.id)) throw new Error('应用编号无效。')
    if (typeof input.code !== 'string' || input.code.length < 1 || input.code.length > maxCode) throw new Error('应用源码不能为空或超过 200000 字符。')
    if (input.port !== undefined && (!Number.isInteger(input.port) || input.port < 1024 || input.port > 65535)) throw new Error('应用端口必须在 1024–65535。')
    const existing = apps.get(input.id)
    if (existing?.status === 'running' && input.codeHash !== undefined && existing.codeHash === input.codeHash) return view(existing)
    if (existing) await stop(input.id)
    if (apps.size >= 8) throw new Error('同时运行的可编程应用不能超过 8 个。')
    const directory = await mkdtemp(path.join(tmpdir(), 'own-program-app-'))
    const python = toolchainPaths().python
    const env = executionEnv(directory, { PYTHONNOUSERSITE: '1', PYTHONUNBUFFERED: '1', OWN_APP_HOST: '127.0.0.1' })
    const runtimeHasFlask = await canImportFlask(python, directory, env)
    if (!runtimeHasFlask) {
      await mkdir(path.join(directory, 'flask'), { recursive: true })
      await writeFile(path.join(directory, 'flask', '__init__.py'), flaskCompat, 'utf8')
    }
    const port = await freePort(input.port || 0)
    const appFile = path.join(directory, 'app.py')
    await writeFile(appFile, input.code, 'utf8')
    const app = { id: input.id, framework: 'flask', runtime: runtimeHasFlask ? 'flask' : 'own-flask-compat', status: 'starting', port, directory, child: null, codeHash: input.codeHash, logs: [], requestCount: 0, startedAt: Date.now() }
    env.PYTHONPATH = directory
    env.OWN_APP_PORT = String(port)
    apps.set(app.id, app)
    const runner = `import runpy,sys;sys.path.insert(0,${JSON.stringify(directory)});runpy.run_path(${JSON.stringify(appFile)},run_name='__main__')`
    const child = spawn(python, ['-u', '-c', runner], { cwd: directory, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
    app.child = child
    child.stdout.on('data', chunk => appendLog(app, 'stdout', chunk))
    child.stderr.on('data', chunk => appendLog(app, 'stderr', chunk))
    child.once('error', error => { app.status = 'error'; app.error = error.message; app.finishedAt = Date.now() })
    child.once('close', code => { if (app.status === 'starting' || app.status === 'running') app.status = code === 0 ? 'stopped' : 'error'; app.exitCode = code; app.finishedAt = Date.now() })
    try {
      await waitForPort(app)
      app.status = 'running'
      return view(app)
    } catch (error) {
      app.status = 'error'
      app.error = error.message
      await stop(app.id)
      throw error
    }
  }

  function status(id) {
    const app = apps.get(id)
    return app ? view(app) : { id, status: 'stopped' }
  }

  async function request(id, input = {}) {
    const app = apps.get(id)
    if (!app || app.status !== 'running') throw new Error('应用尚未启动。')
    const method = String(input.method || 'GET').toUpperCase()
    if (!/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/.test(method)) throw new Error('HTTP 方法不受支持。')
    const requestPath = input.path || '/'
    if (!validPath(requestPath)) throw new Error('应用路径必须以 / 开头且不超过 4000 字符。')
    const body = input.body === undefined || input.body === null ? '' : String(input.body)
    if (Buffer.byteLength(body) > maxBody) throw new Error('请求体超过 2 MB。')
    const headers = { ...(input.headers || {}), host: `127.0.0.1:${app.port}`, connection: 'close' }
    delete headers['Content-Length']; delete headers['content-length']
    if (body) headers['content-length'] = Buffer.byteLength(body)
    const value = await new Promise((resolve, reject) => {
      const upstream = http.request({ hostname: '127.0.0.1', port: app.port, path: requestPath, method, headers, timeout: 10000 }, response => {
        const chunks = []; let size = 0; let truncated = false
        response.on('data', chunk => { size += chunk.length; if (size <= maxResponse) chunks.push(chunk); else truncated = true })
        response.on('end', () => resolve({ status: response.statusCode || 500, headers: responseHeaders(response.headers), body: Buffer.concat(chunks).toString('utf8'), truncated }))
      })
      upstream.once('timeout', () => upstream.destroy(new Error('应用请求超时。')))
      upstream.once('error', reject)
      if (body) upstream.write(body)
      upstream.end()
    })
    app.requestCount += 1
    return { ...value, appId: id, method, path: requestPath }
  }

  async function proxy(requestMessage, response, id, requestPath = '/') {
    const app = apps.get(id)
    if (!app || app.status !== 'running') {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('应用尚未启动。'); return
    }
    if (!validPath(requestPath)) { response.writeHead(400); response.end('无效应用路径。'); return }
    if (requestMessage.method === 'OPTIONS') {
      response.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' }); response.end(); return
    }
    app.requestCount += 1
    const headers = { ...requestMessage.headers, host: `127.0.0.1:${app.port}`, connection: 'close', 'accept-encoding': 'identity' }
    delete headers['content-length']
    const chunks = []; let size = 0
    requestMessage.on('data', chunk => {
      size += chunk.length
      if (size <= maxBody) chunks.push(chunk)
      else if (!response.headersSent) { response.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('请求体超过 2 MB。'); requestMessage.destroy() }
    })
    requestMessage.once('end', () => {
      if (response.headersSent) return
      const body = Buffer.concat(chunks)
      if (body.length) headers['content-length'] = body.length
      const upstream = http.request({ hostname: '127.0.0.1', port: app.port, path: requestPath, method: requestMessage.method, headers, timeout: 15000 }, upstreamResponse => {
        const contentType = String(upstreamResponse.headers['content-type'] || '').toLowerCase()
        if (contentType.includes('text/html')) {
          const output = []; let outputSize = 0
          upstreamResponse.on('data', chunk => { outputSize += chunk.length; if (outputSize <= maxResponse) output.push(chunk) })
          upstreamResponse.on('end', () => {
            let value = Buffer.concat(output).toString('utf8')
            const prefix = `/api/program/apps/${id}/proxy`
            value = value.replace(/((?:href|src|action)=["'])\/(?!\/)/gi, `$1${prefix}/`).replace(/url\(\s*\/(?!\/)/gi, `url(${prefix}/`)
            const outputHeaders = { ...upstreamResponse.headers, 'content-length': Buffer.byteLength(value), 'cache-control': 'no-store', 'access-control-allow-origin': '*' }
            delete outputHeaders['content-encoding']
            response.writeHead(upstreamResponse.statusCode || 502, outputHeaders); response.end(value)
          })
        } else {
          const outputHeaders = { ...upstreamResponse.headers, 'cache-control': 'no-store', 'access-control-allow-origin': '*' }
          response.writeHead(upstreamResponse.statusCode || 502, outputHeaders); upstreamResponse.pipe(response)
        }
      })
      upstream.once('timeout', () => upstream.destroy(new Error('应用请求超时。')))
      upstream.once('error', error => { if (!response.headersSent) { response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end(error.message) } else response.destroy() })
      upstream.end(body)
    })
  }

  function close() { closed = true; for (const id of [...apps.keys()]) void stop(id) }
  return { start, stop, status, request, proxy, close }
}
