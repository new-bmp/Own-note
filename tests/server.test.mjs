import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { createFieldnotesServer } from '../server.mjs'
import { initialNotebook } from '../src/model.ts'

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'fieldnotes-server-'))
  const dataDir = path.join(directory, 'data')
  const staticDir = path.join(directory, 'site')
  await mkdir(staticDir)
  await writeFile(
    path.join(staticDir, 'index.html'),
    '<!doctype html><title>Fieldnotes test</title>',
  )
  await writeFile(path.join(staticDir, 'app.js'), 'console.log("test")')
  let server
  let url
  const start = async () => {
    server = await createFieldnotesServer({ dataDir, staticDir })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    url = `http://127.0.0.1:${server.address().port}`
  }
  const close = () =>
    new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  await start()
  t.after(async () => {
    await close()
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()))
    assert.ok(path.basename(directory).startsWith('fieldnotes-server-'))
    await rm(directory, { recursive: true, force: true })
  })
  return {
    request: (route, options) => fetch(`${url}${route}`, options),
    restart: async () => {
      await close()
      await start()
    },
    dataDir,
  }
}

function saveOptions(notebook, etag) {
  return {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(etag ? { 'If-Match': etag } : {}),
    },
    body: JSON.stringify(notebook),
  }
}

test('Node server persists notes, colors and binary attachments across restart', async (t) => {
  const app = await fixture(t)
  const empty = await app.request('/api/notebook')
  assert.deepEqual(await empty.json(), { notebook: null })
  const notebook = initialNotebook()
  notebook.appearance = { accent: '#26745c', canvas: '#edf4ef' }
  notebook.boards[0].notes[0].color = '#20394d'
  notebook.boards[0].notes.push({
    id: 'attachment-note',
    kind: 'file',
    assetId: 'test-file',
    filename: '测试.txt',
    mime: 'text/plain',
    x: 120,
    y: 300,
    width: 200,
    height: 120,
  })
  const bytes = Buffer.from('项目文件\nUTF-8 中文与二进制：\0\x01\x02')
  const upload = await app.request('/api/assets/test-file', {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: bytes,
  })
  assert.equal(upload.status, 200)
  const saved = await app.request(
    '/api/notebook',
    saveOptions(notebook, empty.headers.get('etag')),
  )
  assert.equal(saved.status, 200)
  assert.deepEqual(
    JSON.parse(await readFile(path.join(app.dataDir, 'notebook.json'), 'utf8')),
    notebook,
  )
  await app.restart()
  const restored = await app.request('/api/notebook')
  assert.deepEqual((await restored.json()).notebook, notebook)
  assert.equal(restored.headers.get('etag'), saved.headers.get('etag'))
  const attachment = await app.request('/api/assets/test-file')
  assert.match(attachment.headers.get('content-type'), /^text\/plain/)
  assert.deepEqual(Buffer.from(await attachment.arrayBuffer()), bytes)
  assert.equal((await app.request('/api/health')).status, 200)
})

test('invalid and competing saves cannot replace the last valid workspace', async (t) => {
  const app = await fixture(t)
  const notebook = initialNotebook()
  const empty = await app.request('/api/notebook')
  const first = await app.request(
    '/api/notebook',
    saveOptions(notebook, empty.headers.get('etag')),
  )
  const etag = first.headers.get('etag')
  assert.equal(
    (await app.request('/api/notebook', saveOptions(notebook))).status,
    428,
  )
  assert.equal(
    (
      await app.request(
        '/api/notebook',
        saveOptions(
          { ...notebook, appearance: { accent: 'invalid', canvas: '#ffffff' } },
          etag,
        ),
      )
    ).status,
    400,
  )
  assert.equal(
    (
      await app.request(
        '/api/notebook',
        saveOptions(
          {
            ...notebook,
            appearance: { accent: { toString: '#123456' }, canvas: '#ffffff' },
          },
          etag,
        ),
      )
    ).status,
    400,
  )
  assert.equal(
    (
      await app.request(
        '/api/notebook',
        saveOptions(
          {
            ...notebook,
            boards: notebook.boards.map((board) => ({
              ...board,
              trashed: true,
            })),
          },
          etag,
        ),
      )
    ).status,
    400,
  )
  assert.equal(
    (
      await app.request('/api/notebook', {
        ...saveOptions(notebook, etag),
        headers: {
          ...saveOptions(notebook, etag).headers,
          Origin: 'https://unrelated.example',
        },
      })
    ).status,
    403,
  )
  const updates = ['窗口甲', '窗口乙'].map((title) => ({
    ...notebook,
    boards: notebook.boards.map((board, index) =>
      index === 0 ? { ...board, title } : board,
    ),
  }))
  const results = await Promise.all(
    updates.map((update) =>
      app.request('/api/notebook', saveOptions(update, etag)),
    ),
  )
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409])
  const current = (await (await app.request('/api/notebook')).json()).notebook
  assert.ok(
    updates.some(
      (update) => JSON.stringify(update) === JSON.stringify(current),
    ),
  )
  assert.equal(
    (await app.request('/api/notebook', saveOptions(notebook, etag))).status,
    409,
  )
})

test('production serves the built app while keeping data and source files private', async (t) => {
  const app = await fixture(t)
  assert.match(await (await app.request('/')).text(), /Fieldnotes test/)
  assert.match(
    (await app.request('/app.js')).headers.get('content-type'),
    /javascript/,
  )
  assert.equal((await app.request('/app.js', { method: 'HEAD' })).status, 200)
  assert.equal((await app.request('/server.mjs')).status, 404)
  assert.equal((await app.request('/data/notebook.json')).status, 404)
  assert.equal((await app.request('/api/assets/..%2Fnotebook')).status, 400)
  const before = '{invalid saved data'
  await writeFile(path.join(app.dataDir, 'notebook.json'), before)
  assert.equal((await app.request('/api/notebook')).status, 500)
  assert.equal(
    (
      await app.request(
        '/api/notebook',
        saveOptions(initialNotebook(), '"empty"'),
      )
    ).status,
    500,
  )
  assert.equal(
    await readFile(path.join(app.dataDir, 'notebook.json'), 'utf8'),
    before,
  )
})
