import test from 'node:test'
import assert from 'node:assert/strict'
import { createProgramApps } from '../services/program-apps.mjs'
import { toolchainPaths } from '../services/toolchains.mjs'
import { spawnSync } from 'node:child_process'
import { createFieldnotesServer } from '../server.mjs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { initialNotebook } from '../src/model.ts'

const python = toolchainPaths().python
const available = spawnSync(python, ['--version'], { windowsHide: true, stdio: 'ignore' }).status === 0

test('integrated Flask app runs a UI and returns JSON responses', { skip: !available }, async () => {
  const apps = createProgramApps()
  try {
    const code = `from flask import Flask, request, jsonify
import os
app = Flask(__name__)
@app.get('/')
def home(): return '<h1>Own App</h1>'
@app.post('/echo')
def echo(): return jsonify(received=request.get_json(silent=True))
if __name__ == '__main__': app.run(host='127.0.0.1', port=int(os.environ['OWN_APP_PORT']))
`
    const started = await apps.start({ id: 'test-flask-app', framework: 'flask', language: 'python', code })
    assert.equal(started.status, 'running')
    assert.match(started.runtime, /flask/)
    const page = await apps.request('test-flask-app', { method: 'GET', path: '/' })
    assert.equal(page.status, 200)
    assert.match(page.body, /Own App/)
    const response = await apps.request('test-flask-app', { method: 'POST', path: '/echo', headers: { 'Content-Type': 'application/json' }, body: '{"value":42}' })
    assert.equal(response.status, 200)
    assert.deepEqual(JSON.parse(response.body), { received: { value: 42 } })
    assert.equal(apps.status('test-flask-app').requestCount, 2)
  } finally {
    await apps.stop('test-flask-app')
    apps.close()
  }
})

test('program app HTTP endpoints expose status, proxy and request responses', { skip: !available }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'own-program-app-server-'))
  const server = await createFieldnotesServer({ dataDir: directory })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const url = `http://127.0.0.1:${server.address().port}`
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  })
  const code = `from flask import Flask, request
import os
app = Flask(__name__)
@app.get('/')
def home(): return '<h1>Proxy</h1>'
@app.post('/echo')
def echo(): return request.data.decode('utf-8')
if __name__ == '__main__': app.run(host='127.0.0.1', port=int(os.environ['OWN_APP_PORT']))
`
  const started = await (await fetch(`${url}/api/program/apps/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'server-app', framework: 'flask', language: 'python', code }) })).json()
  assert.equal(started.status, 'running')
  const status = await (await fetch(`${url}/api/program/apps/server-app/status`)).json()
  assert.equal(status.status, 'running')
  const proxy = await fetch(`${url}/api/program/apps/server-app/proxy/`)
  assert.equal(proxy.status, 200)
  assert.match(await proxy.text(), /Proxy/)
  const echoed = await fetch(`${url}/api/program/apps/server-app/proxy/echo`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '来自画布' })
  assert.equal(echoed.status, 200)
  assert.equal(await echoed.text(), '来自画布')
  assert.equal((await (await fetch(`${url}/api/program/apps/server-app/stop`, { method: 'POST' })).json()).status, 'stopped')
})

test('MCP creates, starts and exercises an integrated program app', { skip: !available }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'own-program-app-mcp-'))
  const server = await createFieldnotesServer({ dataDir: directory })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const url = `http://127.0.0.1:${server.address().port}`
  const empty = await fetch(`${url}/api/notebook`)
  const notebook = initialNotebook()
  await fetch(`${url}/api/notebook`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': empty.headers.get('etag') }, body: JSON.stringify(notebook) })
  const client = new Client({ name: 'program-app-test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)))
  t.after(async () => {
    await client.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  })
  const boardId = notebook.activeBoardId
  const code = `from flask import Flask, request, jsonify
import os
app = Flask(__name__)
@app.post('/echo')
def echo(): return jsonify(received=request.get_json(silent=True))
if __name__ == '__main__': app.run(host='127.0.0.1', port=int(os.environ['OWN_APP_PORT']))
`
  const added = await client.callTool({ name: 'own_add_program', arguments: { boardId, requestId: 'mcp-program-app', title: 'MCP 应用', cells: [{ language: 'python', code, stdin: '' }], app: { framework: 'flask', enabled: true } } })
  assert.ok(!added.isError, JSON.stringify(added.content))
  const noteId = added.structuredContent.noteIds[0]
  const read = await client.callTool({ name: 'own_read_note', arguments: { boardId, noteId } })
  const started = await client.callTool({ name: 'own_start_program_app', arguments: { boardId, noteId, expectedHash: read.structuredContent.contentHash, requestId: 'mcp-program-app-start' } })
  assert.ok(!started.isError, JSON.stringify(started.content))
  const response = await client.callTool({ name: 'own_program_app_request', arguments: { appId: started.structuredContent.id, method: 'POST', path: '/echo', headers: { 'Content-Type': 'application/json' }, body: '{"from":"mcp"}' } })
  assert.ok(!response.isError, JSON.stringify(response.content))
  assert.deepEqual(JSON.parse(response.structuredContent.body), { received: { from: 'mcp' } })
  const stopped = await client.callTool({ name: 'own_stop_program_app', arguments: { appId: started.structuredContent.id } })
  assert.ok(!stopped.isError, JSON.stringify(stopped.content))
})
