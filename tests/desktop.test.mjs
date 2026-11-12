import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { prepareWorkspace, startDesktopHost } from '../desktop/host.mjs'
import { workspaceIdentity } from '../server.mjs'
import { initialNotebook } from '../src/model.ts'

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'own-desktop-'))
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()))
    assert.ok(path.basename(root).startsWith('own-desktop-'))
    await rm(root, { recursive: true, force: true })
  })
  return { root, dataDir: path.join(root, 'workspace'), legacyDir: path.join(root, 'legacy') }
}

test('desktop migration preserves notes and attachments and never overwrites an existing workspace', async t => {
  const { root, dataDir, legacyDir } = await fixture(t)
  await mkdir(path.join(legacyDir, 'assets'), { recursive: true })
  const notebook = initialNotebook()
  await writeFile(path.join(legacyDir, 'notebook.json'), JSON.stringify(notebook))
  await writeFile(path.join(legacyDir, 'assets', 'original-file'), Buffer.from([0, 1, 255, 42]))
  await writeFile(path.join(legacyDir, 'unrelated.txt'), 'not part of the workspace')
  assert.equal(await prepareWorkspace(dataDir, legacyDir), true)
  assert.deepEqual(JSON.parse(await readFile(path.join(dataDir, 'notebook.json'), 'utf8')), notebook)
  assert.deepEqual(await readFile(path.join(dataDir, 'assets', 'original-file')), Buffer.from([0, 1, 255, 42]))
  await assert.rejects(stat(path.join(dataDir, 'unrelated.txt')), { code: 'ENOENT' })
  notebook.boards[0].title = 'Changed only in the old copy'
  await writeFile(path.join(legacyDir, 'notebook.json'), JSON.stringify(notebook))
  assert.equal(await prepareWorkspace(dataDir, legacyDir), false)
  assert.notEqual(JSON.parse(await readFile(path.join(dataDir, 'notebook.json'), 'utf8')).boards[0].title, notebook.boards[0].title)
  assert.equal(JSON.parse(await readFile(path.join(legacyDir, 'notebook.json'), 'utf8')).boards[0].title, notebook.boards[0].title)
  assert.ok((await stat(root)).isDirectory())
})

test('invalid legacy data and nonempty targets are preserved without a partial import', async t => {
  const { dataDir, legacyDir } = await fixture(t)
  await mkdir(legacyDir)
  await writeFile(path.join(legacyDir, 'notebook.json'), '{}')
  await assert.rejects(prepareWorkspace(dataDir, legacyDir), /无效/)
  await assert.rejects(stat(dataDir), { code: 'ENOENT' })
  await writeFile(path.join(legacyDir, 'notebook.json'), JSON.stringify(initialNotebook()))
  await mkdir(dataDir)
  await writeFile(path.join(dataDir, 'keep.txt'), 'keep')
  await assert.rejects(prepareWorkspace(dataDir, legacyDir), /不为空/)
  assert.equal(await readFile(path.join(dataDir, 'keep.txt'), 'utf8'), 'keep')
  await assert.rejects(stat(path.join(dataDir, 'notebook.json')), { code: 'ENOENT' })
})

test('desktop chooses a free port when another application owns the preferred port', async t => {
  const { dataDir } = await fixture(t)
  const other = http.createServer((_, response) => response.end('{"ok":true}'))
  other.listen(0, '127.0.0.1')
  await once(other, 'listening')
  t.after(() => new Promise(resolve => other.close(resolve)))
  const runtime = await startDesktopHost({ dataDir, legacyDir: null, preferredPort: other.address().port })
  t.after(() => runtime.close())
  assert.notEqual(Number(new URL(runtime.url).port), other.address().port)
  const health = await (await fetch(runtime.url + '/api/health')).json()
  assert.equal(health.application, 'own-notes')
  assert.equal(health.workspaceId, workspaceIdentity(dataDir))
  assert.equal(runtime.owned, true)
})

test('desktop reuses the same writer and closing a reused host leaves its owner running', async t => {
  const { dataDir } = await fixture(t)
  const owner = await startDesktopHost({ dataDir, legacyDir: null, preferredPort: 0 })
  t.after(() => owner.close())
  const reused = await startDesktopHost({ dataDir, legacyDir: null, preferredPort: 0 })
  assert.equal(reused.url, owner.url)
  assert.equal(reused.owned, false)
  await reused.close()
  assert.equal((await fetch(owner.url + '/api/health')).status, 200)
  const notebook = initialNotebook()
  const empty = await fetch(owner.url + '/api/notebook')
  assert.equal((await fetch(owner.url + '/api/notebook', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': empty.headers.get('ETag') }, body: JSON.stringify(notebook),
  })).status, 200)
  await owner.close()
  await assert.rejects(stat(`${dataDir}.own-lock`), { code: 'ENOENT' })
  const restarted = await startDesktopHost({ dataDir, legacyDir: null, preferredPort: 0 })
  t.after(() => restarted.close())
  assert.deepEqual((await (await fetch(restarted.url + '/api/notebook')).json()).notebook, notebook)
})

test('desktop reclaims a dead owner but keeps an unreadable lock intact', async t => {
  const { dataDir } = await fixture(t)
  await writeFile(`${dataDir}.own-lock`, '{"pid":2147483647}')
  const runtime = await startDesktopHost({ dataDir, legacyDir: null, preferredPort: 0 })
  await runtime.close()
  await writeFile(`${dataDir}.own-lock`, 'in-progress')
  await assert.rejects(startDesktopHost({ dataDir, legacyDir: null, preferredPort: 0 }), /启动或使用中/)
  assert.equal(await readFile(`${dataDir}.own-lock`, 'utf8'), 'in-progress')
})

test('native host exits and releases the workspace when its parent closes stdin', { timeout: 15000 }, async t => {
  const { dataDir } = await fixture(t)
  const child = spawn(process.execPath, ['desktop/host.mjs'], { cwd: process.cwd(), env: { ...process.env, FIELDNOTES_DATA_DIR: dataDir, OWN_DESKTOP_PORT: '0' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  t.after(() => { if (child.exitCode === null) child.kill() })
  let output = '', errors = ''
  child.stderr.on('data', chunk => { errors += chunk })
  const ready = await new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => {
      output += chunk
      const line = output.split('\n').find(line => line.startsWith('{'))
      if (line) { try { resolve(JSON.parse(line)) } catch {} }
    })
    child.once('error', reject)
    child.once('exit', code => reject(new Error(`Host exited ${code}: ${errors}`)))
  })
  assert.equal(ready.event, 'ready')
  assert.equal((await fetch(ready.url + '/api/health')).status, 200)
  const exit = once(child, 'exit')
  child.stdin.end()
  assert.equal((await exit)[0], 0)
  await assert.rejects(stat(`${dataDir}.own-lock`), { code: 'ENOENT' })
  await assert.rejects(fetch(ready.url + '/api/health'))
})

test('native close waits for saving, reports failure, and detaches without changing web clients', async t => {
  const previousWindow = globalThis.window
  t.after(() => { globalThis.window = previousWindow })
  const { onDesktopClose } = await import('../src/desktop.ts')
  globalThis.window = {}
  assert.doesNotThrow(() => onDesktopClose(async () => 'saved')())
  let listener
  const messages = []
  window.ownDesktop = { platform: 'windows', version: 1 }
  window.chrome = { webview: {
    addEventListener: (_, next) => { listener = next },
    removeEventListener: (_, next) => { if (listener === next) listener = undefined },
    postMessage: value => messages.push(value),
  } }
  let complete
  const remove = onDesktopClose(() => new Promise(resolve => { complete = resolve }))
  const pending = listener({ data: { type: 'own:prepare-close', requestId: 'save-1', discardDraft: false } })
  assert.equal(messages.length, 1) // Readiness is separate from the save acknowledgement.
  complete('saved')
  await pending
  assert.deepEqual(messages[1], { type: 'own:close-result', requestId: 'save-1', status: 'saved' })
  remove()
  assert.equal(listener, undefined)
  const detach = onDesktopClose(async () => { throw new Error('disk unavailable') })
  await listener({ data: { type: 'own:prepare-close', requestId: 'save-2', discardDraft: false } })
  assert.equal(messages.at(-1).status, 'error')
  detach()
})

test('native attachment opening correlates replies, reports errors and removes pending listeners', async t => {
  const previousWindow = globalThis.window
  t.after(() => { globalThis.window = previousWindow })
  const { openNativeAsset } = await import('../src/desktop.ts')
  globalThis.window = {}
  await assert.rejects(openNativeAsset('test-id', '文档.docx'), /客户端/)
  const listeners = new Set(), messages = []
  window.ownDesktop = { platform: 'windows', version: 1 }
  window.chrome = { webview: {
    addEventListener: (_, listener) => listeners.add(listener),
    removeEventListener: (_, listener) => listeners.delete(listener),
    postMessage: (message) => messages.push(message),
  } }
  const emit = (data) => { for (const listener of [...listeners]) listener({ data }) }
  const opened = openNativeAsset('test-id', '中文.docx')
  assert.equal(listeners.size, 1)
  assert.equal(messages[0].assetId, 'test-id')
  assert.equal(messages[0].filename, '中文.docx')
  emit({ type: 'own:asset-open-result', requestId: 'other-request', status: 'opened' })
  assert.equal(listeners.size, 1)
  emit({ type: 'own:asset-open-result', requestId: messages[0].requestId, status: 'opened' })
  await opened
  assert.equal(listeners.size, 0)
  const blocked = openNativeAsset('test-id', '执行.exe')
  emit({ type: 'own:asset-open-result', requestId: messages[1].requestId, status: 'error', error: '此类型请另存为后自行打开。' })
  await assert.rejects(blocked, /另存为/)
  assert.equal(listeners.size, 0)
})
