import http from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validNotebook } from './shared/validation.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createOwnMcpServer } from './mcp/server.mjs'
import { toolCatalog } from './mcp/guide.mjs'
import { createJobs } from './services/jobs.mjs'
import { createMcpLab } from './mcp/workbench.mjs'
import { createAssetTransfer } from './services/asset-transfer.mjs'
import { createDebugSessions } from './services/debug.mjs'
import { migrateAgentProjects } from './shared/agent-workspace.js'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))
const assetIdPattern = /^[a-zA-Z0-9_-]{1,128}$/
export const workspaceIdentity = (dataDir) =>
  createHash('sha256')
    .update(process.platform === 'win32' ? path.resolve(dataDir).toLowerCase() : path.resolve(dataDir))
    .digest('hex')
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
}

function json(response, status, value, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  })
  response.end(JSON.stringify(value))
}

async function body(request, maximum) {
  const chunks = []
  let length = 0
  for await (const chunk of request) {
    length += chunk.length
    if (length > maximum)
      throw Object.assign(new Error('内容超过保存大小限制。'), { status: 413 })
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function atomicWrite(filename, contents) {
  const temporary = `${filename}.${randomUUID()}.tmp`
  await writeFile(temporary, contents)
  await rename(temporary, filename)
}

function revision(contents) {
  return `"${createHash('sha256').update(contents).digest('hex')}"`
}

export async function createFieldnotesServer({
  dataDir = process.env.FIELDNOTES_DATA_DIR || path.join(projectRoot, 'data'),
  staticDir = path.join(projectRoot, 'dist'),
  development = false,
} = {}) {
  dataDir = path.resolve(dataDir)
  staticDir = path.resolve(staticDir)
  const notebookFile = path.join(dataDir, 'notebook.json')
  const assetsDir = path.join(dataDir, 'assets')
  const derivedDir = path.join(dataDir, 'derived')
  const jobs = createJobs({ assetsDir, derivedDir })
  const debugging = createDebugSessions()
  await mkdir(assetsDir, { recursive: true })
  let writeQueue = Promise.resolve()
  const eventClients = new Set()
  let vite

  function publishWorkspace(contents) {
    void lab.reconcile(JSON.parse(contents))
    const event = `event: workspace\ndata: ${JSON.stringify({ etag: revision(contents) })}\n\n`
    for (const response of eventClients) response.write(event)
  }

  async function readWorkspace() {
    try {
      const contents = await readFile(notebookFile, 'utf8')
      const notebook = JSON.parse(contents)
      if (!validNotebook(notebook)) throw new Error('Invalid saved workspace')
      return { notebook:migrateAgentProjects(notebook), etag: revision(contents) }
    } catch (error) {
      if (error.code === 'ENOENT') return { notebook: null, etag: '"empty"' }
      throw error
    }
  }

  function mutateWorkspace(mutator) {
    const pending = writeQueue.then(async () => {
      const { notebook } = await readWorkspace()
      const change = await mutator(structuredClone(notebook))
      if (!change.unchanged) {
        if (!validNotebook(change.notebook))
          throw new Error('笔记结构无效，未保存更改。')
        const contents = JSON.stringify(change.notebook, null, 2)
        if (Buffer.byteLength(contents) > 20 * 1024 * 1024)
          throw new Error('工作空间超过 20 MB，请减少本次写入内容。')
        await atomicWrite(notebookFile, contents)
        publishWorkspace(contents)
      }
      return change.result
    })
    writeQueue = pending.catch(() => {})
    return pending
  }

  const assets=createAssetTransfer(assetsDir)
  const lab=createMcpLab({jobs,debugging,readWorkspace,mutateWorkspace})

  async function serveStatic(request, response, pathname) {
    const filename = path.resolve(staticDir, `.${pathname}`)
    if (
      filename !== staticDir &&
      !filename.startsWith(`${staticDir}${path.sep}`)
    )
      return json(response, 403, { error: '无效路径。' })
    let target = filename
    let info
    try {
      info = await stat(target)
      if (info.isDirectory()) target = path.join(target, 'index.html')
      info = await stat(target)
    } catch {
      if (path.extname(pathname))
        return json(response, 404, { error: '文件不存在。' })
      target = path.join(staticDir, 'index.html')
      try {
        info = await stat(target)
      } catch {
        return json(response, 503, {
          error: '请先运行 npm run build，再启动正式服务。',
        })
      }
    }
    response.writeHead(200, {
      'Content-Type':
        mimeTypes[path.extname(target)] || 'application/octet-stream',
      'Content-Length': info.size,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control':
        path.basename(target) === 'index.html'
          ? 'no-cache'
          : 'public, max-age=3600',
    })
    if (request.method === 'HEAD') return response.end()
    createReadStream(target)
      .on('error', () => response.destroy())
      .pipe(response)
  }

  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(
        new URL(request.url, 'http://localhost').pathname,
      )
      if (pathname.includes('\0'))
        return json(response, 400, { error: '无效路径。' })
      if (pathname === '/mcp' || pathname.startsWith('/api/')) {
        const host = new URL(`http://${request.headers.host || 'invalid'}`)
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname))
          return json(response, 403, { error: '仅接受本机工作空间连接。' })
        if (request.headers.origin) {
          let origin
          try {
            origin = new URL(request.headers.origin)
          } catch {
            return json(response, 403, { error: '无效来源。' })
          }
          if (origin.host !== host.host || origin.protocol !== 'http:')
            return json(response, 403, { error: '仅接受当前工作空间的请求。' })
        }
      }
      if (pathname === '/mcp') {
        if (request.method !== 'POST')
          return json(
            response,
            405,
            {
              jsonrpc: '2.0',
              error: {
                code: -32000,
                message: '请使用 Streamable HTTP POST 或 stdio 连接。',
              },
              id: null,
            },
            { Allow: 'POST' },
          )
        if (!request.headers['content-type']?.startsWith('application/json'))
          return json(response, 415, {
            error: 'MCP 请求需要 application/json。',
          })
        let message
        try {
          message = JSON.parse(
            (await body(request, 4 * 1024 * 1024)).toString('utf8'),
          )
        } catch (error) {
          return json(response, error.status || 400, {
            jsonrpc: '2.0',
            error: {
              code: -32700,
              message: error.status ? error.message : '无效的 JSON。',
            },
            id: null,
          })
        }
        const mcp = createOwnMcpServer({
          readWorkspace,
          mutateWorkspace,lab,jobs,assets,
          baseUrl: `http://${request.headers.host}`,
        })
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        })
        response.on('close', () => {
          void mcp.close().catch(() => {})
        })
        await mcp.connect(transport)
        await transport.handleRequest(request, response, message)
        return
      }
      if (pathname.startsWith('/api/')) {
        if (pathname.startsWith('/api/lab/')) {
          try {
            if(pathname==='/api/lab/debug'&&request.method==='POST')return json(response,202,debugging.start(JSON.parse((await body(request,600000)).toString('utf8'))))
            const debug=pathname.match(/^\/api\/lab\/debug\/([a-f\d-]{36})$/)
            if(debug&&request.method==='GET')return json(response,200,debugging.get(debug[1]))
            if(debug&&request.method==='POST')return json(response,200,await debugging.command(debug[1],JSON.parse((await body(request,20000)).toString('utf8'))))
            if (pathname === '/api/lab/runtimes' && request.method === 'GET') return json(response, 200, await jobs.runtimes())
            if (['/api/lab/code', '/api/lab/convert'].includes(pathname) && request.method === 'POST') {
              const args = JSON.parse((await body(request, 600000)).toString('utf8'))
              return json(response, 202, jobs.start(pathname.endsWith('code') ? 'code' : 'media', args))
            }
            const match = pathname.match(/^\/api\/lab\/jobs\/([a-f\d-]{36})$/)
            if (match && request.method === 'GET') return json(response, 200, jobs.get(match[1]))
            if (match && request.method === 'DELETE') { jobs.cancel(match[1]); return json(response,200,{ok:true}) }
            const media = pathname.match(/^\/api\/lab\/media\/([a-f\d-]{36}\.(mp3|mp4))$/)
            if (media && ['GET','HEAD'].includes(request.method)) {
              const target=path.join(derivedDir,media[1]), info=await stat(target)
              const range=request.headers.range?.match(/^bytes=(\d*)-(\d*)$/)
              const start=range?(range[1]?Number(range[1]):Math.max(0,info.size-Number(range[2]))):0, end=range&&range[1]&&range[2]?Math.min(Number(range[2]),info.size-1):info.size-1
              if(request.headers.range&&!range||range&&!range[1]&&!Number(range[2])||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=info.size){ response.writeHead(416,{'Content-Range':`bytes */${info.size}`});return response.end() }
              response.writeHead(range?206:200,{'Content-Type':media[2]==='mp3'?'audio/mpeg':'video/mp4','Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(range?{'Content-Range':`bytes ${start}-${end}/${info.size}`}:{})})
              if(request.method==='HEAD')return response.end()
              return createReadStream(target,{start,end}).on('error',()=>response.destroy()).pipe(response)
            }
            return json(response,404,{error:'工作台接口不存在。'})
          } catch(error){ return json(response,error.code==='ENOENT'?404:400,{error:error.message}) }
        }
        if (pathname === '/api/events' && request.method === 'GET') {
          response.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'X-Accel-Buffering': 'no',
          })
          response.write(': Own workspace connected\n\n')
          eventClients.add(response)
          const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 15000)
          heartbeat.unref()
          response.on('close', () => {
            clearInterval(heartbeat)
            eventClients.delete(response)
          })
          return
        }
        if (pathname === '/api/health' && request.method === 'GET')
          return json(response, 200, {
            ok: true,
            application: 'own-notes',
            workspaceId: workspaceIdentity(dataDir),
            runtime: 'node',
            version: process.versions.node,
          })
        if (pathname === '/api/integrations' && request.method === 'GET') {
          const url = `http://${request.headers.host}/mcp`
          const stdio = {
            command: process.execPath,
            args: [path.join(projectRoot, 'mcp-stdio.mjs')],
            env: { OWN_URL: `http://${request.headers.host}` },
          }
          return json(response, 200, {
            name: 'own-notes',
            url,
            transport: 'streamable-http',
            stdio,
            tools: toolCatalog,
          })
        }
        if (pathname === '/api/notebook') {
          if (request.method === 'GET') {
            const { notebook, etag } = await readWorkspace()
            if (request.headers['if-none-match'] === etag) {
              response.writeHead(304, {
                ETag: etag,
                'Cache-Control': 'no-store',
              })
              return response.end()
            }
            return json(response, 200, { notebook }, { ETag: etag })
          }
          if (request.method === 'PUT') {
            let notebook
            try {
              notebook = JSON.parse(
                (await body(request, 20 * 1024 * 1024)).toString('utf8'),
              )
            } catch (error) {
              return json(response, error.status || 400, {
                error: '笔记内容格式无效。',
              })
            }
            if (!validNotebook(notebook))
              return json(response, 400, { error: '笔记内容格式无效。' })
            if (!request.headers['if-match'])
              return json(response, 428, {
                error: '保存前请先读取当前工作空间。',
              })
            const save = writeQueue.then(async () => {
              const current = await readWorkspace()
              if (request.headers['if-match'] !== current.etag)
                return json(response, 409, {
                  error: '另一个窗口已保存更新，请先导出当前内容，再刷新页面。',
                })
              const contents = JSON.stringify(notebook, null, 2)
              await atomicWrite(notebookFile, contents)
              publishWorkspace(contents)
              return json(
                response,
                200,
                { ok: true },
                { ETag: revision(contents) },
              )
            })
            writeQueue = save.catch(() => {})
            return await save
          }
          return json(
            response,
            405,
            { error: '不支持的请求方法。' },
            { Allow: 'GET, PUT' },
          )
        }
        if (pathname.startsWith('/api/assets/')) {
          const id = pathname.slice('/api/assets/'.length)
          if (!assetIdPattern.test(id))
            return json(response, 400, { error: '无效附件编号。' })
          const filename = path.join(assetsDir, id)
          if (request.method === 'PUT') {
            const blob = await body(request, 100 * 1024 * 1024)
            const mime =
              request.headers['content-type'] || 'application/octet-stream'
            if (!/^[\w.+-]+\/[\w.+-]+(?:;[\x20-\x7e]*)?$/.test(mime))
              return json(response, 400, { error: '附件类型无效。' })
            const contentHash = createHash('sha256').update(blob).digest('hex')
            const contentFile = `${filename}.${contentHash}.blob`
            await atomicWrite(contentFile, blob)
            await atomicWrite(
              `${filename}.json`,
              JSON.stringify({ mime, contentHash }),
            )
            return json(response, 200, { ok: true, size: blob.length })
          }
          if (request.method === 'GET' || request.method === 'HEAD') {
            let metadata, info, contentFile
            try {
              metadata = JSON.parse(await readFile(`${filename}.json`, 'utf8'))
              if (!/^[\da-f]{64}$/.test(metadata.contentHash))
                throw new Error('Invalid asset metadata')
              contentFile = `${filename}.${metadata.contentHash}.blob`
              info = await stat(contentFile)
            } catch (error) {
              if (error.code === 'ENOENT')
                return json(response, 404, { error: '附件不存在。' })
              throw error
            }
            response.writeHead(200, {
              'Content-Type': metadata.mime,
              'Content-Length': info.size,
              'X-Content-Type-Options': 'nosniff',
              'Content-Disposition': 'attachment',
              'Cache-Control': 'no-store',
            })
            if (request.method === 'HEAD') return response.end()
            return createReadStream(contentFile)
              .on('error', () => response.destroy())
              .pipe(response)
          }
          return json(
            response,
            405,
            { error: '不支持的请求方法。' },
            { Allow: 'GET, HEAD, PUT' },
          )
        }
        return json(response, 404, { error: '接口不存在。' })
      }
      if (!['GET', 'HEAD'].includes(request.method))
        return json(response, 405, { error: '不支持的请求方法。' })
      if (vite)
        return vite.middlewares(request, response, () =>
          json(response, 404, { error: '页面不存在。' }),
        )
      return await serveStatic(request, response, pathname)
    } catch (error) {
      if (response.headersSent) return response.destroy()
      if (error instanceof URIError)
        return json(response, 400, { error: '无效路径。' })
      console.error('[Own]', error.message)
      json(response, error.status || 500, {
        error: '本地数据暂时无法读取或保存，请保留当前内容并重试。',
      })
    }
  })
  const close = server.close.bind(server)
  server.close = (callback) => {
    lab.close()
    assets.close()
    jobs.close()
    debugging.close()
    for (const response of eventClients) response.end()
    eventClients.clear()
    return close(callback)
  }
  if (development) {
    const { createServer } = await import('vite')
    vite = await createServer({
      configFile: path.join(projectRoot, 'vite.config.ts'),
      root: projectRoot,
      server: { middlewareMode: true, hmr: { server } },
      appType: 'spa',
    })
    server.on('close', () => {
      void vite.close()
    })
  }
  return server
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PORT || 5173)
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT 必须是 1–65535 之间的整数。')
  const server = await createFieldnotesServer({
    development: process.argv.includes('--dev'),
  })
  server.on('error', (error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  server.listen(port, '127.0.0.1', () =>
    console.log(
      `Own · Node.js ${process.versions.node}\nhttp://127.0.0.1:${port}/`,
    ),
  )
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => server.close(() => process.exit(0)))
}
