import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createFieldnotesServer } from '../server.mjs'
import { initialNotebook } from '../src/model.ts'

test('workspace stream announces committed browser and MCP saves and closes with the server', { timeout: 10000 }, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'own-events-'))
  const server = await createFieldnotesServer({ dataDir: directory })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const url = `http://127.0.0.1:${server.address().port}`
  const client = new Client({ name: 'own-events-test', version: '1' })
  const abort = new AbortController()
  t.after(async () => {
    abort.abort()
    await client.close()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()))
    assert.ok(path.basename(directory).startsWith('own-events-'))
    await rm(directory, { recursive: true, force: true })
  })

  const forbidden = await fetch(url + '/api/events', { headers: { Origin: 'http://example.com' } })
  assert.equal(forbidden.status, 403)
  const stream = await fetch(url + '/api/events', { signal: abort.signal })
  assert.match(stream.headers.get('content-type'), /^text\/event-stream/)
  const reader = stream.body.getReader()
  const decoder = new TextDecoder()
  assert.match(decoder.decode((await reader.read()).value), /connected/)
  const empty = await fetch(url + '/api/notebook')
  const notebook = initialNotebook()
  const saved = await fetch(url + '/api/notebook', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'If-Match': empty.headers.get('etag') },
    body: JSON.stringify(notebook),
  })
  assert.equal(saved.status, 200)
  const browserEvent = decoder.decode((await reader.read()).value)
  assert.match(browserEvent, /event: workspace/)
  assert.equal(JSON.parse(browserEvent.split('data: ')[1]).etag, saved.headers.get('etag'))

  await client.connect(new StreamableHTTPClientTransport(new URL(url + '/mcp')))
  const added = await client.callTool({
    name: 'own_add_note',
    arguments: { boardId: notebook.activeBoardId, requestId: 'live-note', title: '即时写入', body: '内容逐段抵达画布' },
  })
  assert.ok(!added.isError, JSON.stringify(added.content))
  const agentEvent = decoder.decode((await reader.read()).value)
  const committed = await fetch(url + '/api/notebook')
  assert.equal(JSON.parse(agentEvent.split('data: ')[1]).etag, committed.headers.get('etag'))
  assert.ok((await committed.json()).notebook.boards[0].notes.some((note) => note.title === '即时写入'))
  await client.close()
  await new Promise((resolve) => server.close(resolve))
  assert.equal((await reader.read()).done, true)
})
