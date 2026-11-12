import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { JSDOM } from 'jsdom'
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { makeBoard, makeNote } from '../src/model.ts'
import { createFieldnotesServer } from '../server.mjs'

test('presentation UI drags and navigates snapshots, renders complete read-only details and blocks App editing shortcuts without any save', { timeout: 30000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'own-presentation-'))
  const backend = await createFieldnotesServer({ dataDir: directory })
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening')
  const url = `http://127.0.0.1:${backend.address().port}`
  const nativeFetch = globalThis.fetch
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url, pretendToBeVisual: true })
  const uiErrors = []
  dom.window.addEventListener('error', event => { uiErrors.push(event.error); event.preventDefault() })
  const previous = new Map(), install = (name, value) => {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, value, writable: true })
  }
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'localStorage', 'MutationObserver']) install(name, name === 'window' ? dom.window : dom.window[name])
  install('IS_REACT_ACT_ENVIRONMENT', true)
  install('requestAnimationFrame', callback => setTimeout(() => callback(Date.now()), 0))
  install('cancelAnimationFrame', clearTimeout)
  install('ResizeObserver', class { observe() {} disconnect() {} })
  install('EventSource', class { addEventListener() {} close() {} })
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  window.HTMLElement.prototype.setPointerCapture = () => {}
  window.HTMLElement.prototype.hasPointerCapture = () => false
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 })
  Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 800 })
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 })
  const messages = [], listeners = new Set(), requests = []
  window.ownDesktop = { platform: 'windows', version: 1 }
  window.chrome = { webview: {
    addEventListener: (_, listener) => listeners.add(listener), removeEventListener: (_, listener) => listeners.delete(listener),
    postMessage: message => { messages.push(message); if (message.type === 'own:presentation') queueMicrotask(() => { for (const listener of listeners) listener({ data: { type: 'own:presentation-result', requestId: message.requestId, status: 'ok' } }) }) },
  } }
  install('fetch', (route, options) => { requests.push({ route: String(route), method: options?.method || 'GET' }); return nativeFetch(new URL(route, url), options) })
  let compiledDirectory, root
  t.after(async () => {
    if (root) await act(async () => root.unmount())
    if (compiledDirectory) {
      assert.equal(path.dirname(compiledDirectory), path.join(process.cwd(), 'artifacts'))
      assert.ok(path.basename(compiledDirectory).startsWith('presentation-test-'))
      await rm(compiledDirectory, { recursive: true, force: true })
    }
    dom.window.close()
    for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name] }
    backend.closeAllConnections(); await new Promise(resolve => backend.close(resolve))
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()))
    assert.ok(path.basename(directory).startsWith('own-presentation-'))
    await rm(directory, { recursive: true, force: true })
  })
  const board = makeBoard('汇报验收', 'blank'), child = { ...makeBoard('详细依据', 'blank'), parentBoardId: board.id }
  const text = { ...makeNote('text', 10, 20), title: '完整正文', body: '开始\n' + '详细段落。'.repeat(800) + '\n正文结尾' }
  const code = { ...makeNote('code', 500, 20), title: '代码示例' }
  code.cells = [{ id: 'first', language: 'python', code: 'print(42)', stdin: '输入不丢失', expected: '42\n', output: '42\n', error: '已保存的诊断' }, { id: 'second', language: 'cpp', code: '#include <iostream>\nint main() { std::cout << 7; }', stdin: '第二单元输入', output: '7' }]
  const tasks = { ...makeNote('checklist', 10, 500), items: [{ id: 'task', text: '保留原始状态', done: false }] }
  const analysis = { ...makeNote('analysis', 500, 500), title: '分析详情', analysisSource: '类别,数值\nA,3\nB,7' }
  const portal = { ...makeNote('board', 1000, 20), childBoardId: child.id }
  board.notes = [text, code, tasks, analysis, portal]
  child.notes = [{ ...makeNote('text', 50, 50), title: '下级内容', body: '子画布正文' }]
  const notebook = { version: 1, workspaceVersion: 1, boards: [board, child], activeBoardId: board.id }
  const empty = await nativeFetch(url + '/api/notebook')
  assert.equal((await nativeFetch(url + '/api/notebook', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': empty.headers.get('etag') }, body: JSON.stringify(notebook) })).status, 200)
  compiledDirectory = await mkdtemp(path.join(process.cwd(), 'artifacts', 'presentation-test-'))
  const outfile = path.join(compiledDirectory, 'app.mjs')
  await build({ entryPoints: ['src/App.tsx'], outfile, bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic', logLevel: 'silent' })
  const { default: App } = await import(pathToFileURL(outfile).href)
  root = createRoot(document.getElementById('root'))
  await act(async () => { root.render(React.createElement(App, { initialNotebook: notebook })) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 650)) })
  // Exercise the regular editor's atomic creation and undo before entering presentation.
  await act(async () => document.querySelector('.add-content-button').click())
  await act(async () => [...document.querySelectorAll('.add-menu button')].find(button => button.textContent === '子画布').click())
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)) })
  const created = (await (await nativeFetch(url + '/api/notebook')).json()).notebook
  assert.equal(created.boards.length, 3)
  const newChild = created.boards.find(canvas => canvas.id !== board.id && canvas.id !== child.id)
  assert.equal(newChild.parentBoardId, board.id)
  assert.ok(created.boards[0].notes.some(note => note.childBoardId === newChild.id))
  await act(async () => document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)) })
  assert.equal((await (await nativeFetch(url + '/api/notebook')).json()).notebook.boards.length, 2)
  const stored = await (await nativeFetch(url + '/api/notebook')).json(), writes = () => requests.filter(request => request.method !== 'GET' && request.method !== 'HEAD')
  const writeCount = writes().length
  const click = async element => { assert.ok(element, 'control must exist'); await act(async () => { element.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) }) }
  const key = async (key, extra = {}) => { await act(async () => { (document.activeElement || document.body).dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra })) }) }
  const card = id => document.querySelector(`[data-presentation-note="${id}"]`)
  const detail = async id => { await act(async () => card(id).dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }))) }
  const drag = async (element, x, y) => { await act(async () => {
    for (const [type, dx, dy] of [['pointerdown', 0, 0], ['pointermove', x, y], ['pointerup', x, y]]) element.dispatchEvent(Object.assign(new window.MouseEvent(type, { bubbles: true, button: 0, clientX: 100 + dx, clientY: 100 + dy }), { pointerId: 1 }))
  }) }
  await click(document.querySelector('[title="全屏展示，临时布局不会保存"]'))
  assert.equal(messages.at(-1).enabled, true)
  assert.ok(document.querySelector('.app-shell').hasAttribute('inert'))
  assert.equal(document.querySelectorAll('.presentation [contenteditable="true"],.presentation textarea').length, 0)
  const left = card(text.id).style.left
  await drag(card(text.id), 120, 60)
  assert.notEqual(card(text.id).style.left, left)
  await act(async () => document.querySelector('.presentation-tools button').focus())
  await key('Enter')
  assert.equal(document.querySelector('.presentation-detail'), null, 'Enter on a toolbar control must not open the selected card')
  await act(async () => document.querySelector('.presentation-stage').focus())
  for (const [shortcut, extra] of [['Delete', {}], ['z', { ctrlKey: true }], ['d', { ctrlKey: true }], ['s', { ctrlKey: true }], ['Enter', { ctrlKey: true }]]) await key(shortcut, extra)
  const paste = new window.Event('paste', { bubbles: true, cancelable: true }); paste.clipboardData = { getData: () => '不应写入', files: [] }
  await act(async () => document.dispatchEvent(paste))
  assert.equal(document.querySelectorAll('.presentation-card').length, 5)
  await detail(text.id)
  assert.ok(document.querySelector('.presentation-detail-body').textContent.endsWith('正文结尾'))
  await key('Escape')
  assert.equal(document.querySelector('.presentation-detail'), null)
  assert.ok(document.querySelector('.presentation'))
  await detail(code.id)
  const codeText = document.querySelector('.presentation-detail-body').textContent
  for (const value of ['print(42)', '第二单元输入', 'std::cout << 7', '已保存的诊断']) assert.ok(codeText.includes(value))
  assert.equal(document.querySelector('.presentation-detail textarea, .presentation-detail input'), null)
  assert.ok(![...document.querySelectorAll('.presentation-detail button')].some(button => /运行|编辑|保存/.test(button.textContent)))
  await key('Escape')
  await detail(analysis.id)
  assert.match(document.querySelector('.presentation-detail-body').textContent, /统计/)
  assert.match(document.querySelector('.presentation-detail-body').textContent, /当前筛选 2 行/)
  await key('Escape')
  const moved = card(text.id).style.left
  await detail(portal.id)
  assert.ok(card(child.notes[0].id))
  await drag(card(child.notes[0].id), 100, 100)
  await click([...document.querySelectorAll('.presentation-heading button')].find(button => button.textContent === board.title))
  assert.equal(card(text.id).style.left, moved)
  await click([...document.querySelectorAll('.presentation-tools button')].find(button => button.textContent.includes('重置布局')))
  assert.equal(card(text.id).style.left, left)
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)) })
  assert.deepEqual(await (await nativeFetch(url + '/api/notebook')).json(), stored)
  assert.equal(writes().length, writeCount)
  await key('Escape')
  assert.equal(document.querySelector('.presentation'), null)
  assert.equal(document.querySelector('.app-shell').hasAttribute('inert'), false)
  assert.equal(messages.at(-1).enabled, false)
  assert.deepEqual(await (await nativeFetch(url + '/api/notebook')).json(), stored)
  assert.deepEqual(uiErrors, [])
})
