import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import ts from 'typescript'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createFieldnotesServer } from '../server.mjs'
import { initialNotebook } from '../src/model.ts'

test('browser adopts agent updates only while idle, preserves unsaved recovery, and never replays an old snapshot', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'own-sync-'))
  const server = await createFieldnotesServer({ dataDir: directory })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const url = `http://127.0.0.1:${server.address().port}`
  const nativeFetch = globalThis.fetch
  const storageDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'localStorage',
  )
  const cache = new Map()
  const requests = []
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => cache.get(key) ?? null,
      setItem: (key, value) => cache.set(key, value),
      removeItem: (key) => cache.delete(key),
    },
  })
  globalThis.fetch = (route, options) => {
    requests.push({ route: String(route), method: options?.method || 'GET' })
    return nativeFetch(new URL(route, url), options)
  }
  const client = new Client({ name: 'own-sync-test', version: '1' })
  t.after(async () => {
    globalThis.fetch = nativeFetch
    if (storageDescriptor)
      Object.defineProperty(globalThis, 'localStorage', storageDescriptor)
    else delete globalThis.localStorage
    await client.close()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()))
    assert.ok(path.basename(directory).startsWith('own-sync-'))
    await rm(directory, { recursive: true, force: true })
  })
  const empty = await nativeFetch(url + '/api/notebook')
  const notebook = initialNotebook()
  await nativeFetch(url + '/api/notebook', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'If-Match': empty.headers.get('etag'),
    },
    body: JSON.stringify(notebook),
  })
  await client.connect(new StreamableHTTPClientTransport(new URL(url + '/mcp')))
  let code = await readFile(
    new URL('../src/storage.ts', import.meta.url),
    'utf8',
  )
  code = code
    .replaceAll(
      "'./model'",
      JSON.stringify(new URL('../src/model.ts', import.meta.url).href),
    )
    .replaceAll(
      "'../shared/validation.js'",
      JSON.stringify(new URL('../shared/validation.js', import.meta.url).href),
    )
    .replaceAll(
      "'../shared/attachments.js'",
      JSON.stringify(new URL('../shared/attachments.js', import.meta.url).href),
    )
  const output = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText
  const storage = await import(
    `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`
  )
  let current = await storage.loadNotebook()
  const append = async (requestId) => {
    const result = await client.callTool({
      name: 'own_add_note',
      arguments: {
        boardId: current.activeBoardId,
        requestId,
        title: requestId,
        body: 'Agent 保存的结果',
      },
    })
    assert.ok(!result.isError, JSON.stringify(result.content))
  }
  const initial = structuredClone(current)
  await append('agent-one')
  assert.equal(await storage.refreshNotebook(current, () => false), null)
  const refreshed = await storage.refreshNotebook(current, () => true)
  assert.ok(
    refreshed.boards[0].notes.some((note) => note.title === 'agent-one'),
  )
  assert.deepEqual(current, initial)
  current = refreshed
  const putsBefore = requests.filter(
    (request) => request.method === 'PUT',
  ).length
  await storage.writeNotebook(current)
  assert.equal(
    requests.filter((request) => request.method === 'PUT').length,
    putsBefore,
    'adopting a remote snapshot must not write it back',
  )
  assert.equal(
    await storage.refreshNotebook(current, () => true),
    null,
    'unchanged ETag returns no replacement',
  )

  const draft = structuredClone(current)
  draft.boards[0].notes[0].title = '用户尚未保存的修改'
  await append('agent-two')
  await assert.rejects(
    storage.writeNotebook(draft),
    storage.WorkspaceConflictError,
  )
  assert.equal(
    await storage.refreshNotebook(draft, () => true),
    null,
    'dirty content must not be discarded by polling',
  )
  const resolved = await storage.refreshNotebook(draft, () => true, true)
  assert.ok(resolved.boards[0].notes.some((note) => note.title === 'agent-two'))
  assert.equal(
    resolved.boards[0].notes[0].title,
    initial.boards[0].notes[0].title,
  )
  assert.deepEqual(storage.readRecoveryNotebook(), draft)
  await storage.writeNotebook(resolved)
  const remote = (await (await nativeFetch(url + '/api/notebook')).json())
    .notebook
  assert.equal(
    remote.boards[0].notes[0].title,
    initial.boards[0].notes[0].title,
  )
  assert.ok(remote.boards[0].notes.some((note) => note.title === 'agent-two'))
})
