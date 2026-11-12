import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { JSDOM } from 'jsdom'
import { strToU8, zipSync } from 'fflate'
import { collectDrop, groupPickedFiles } from '../src/file-import.ts'
import { importAssets } from '../src/import-assets.ts'
import { readOffice } from '../src/office-preview.ts'
import { initialNotebook, makeNote } from '../src/model.ts'
import { assetIdsForNote, remapNoteAssets, validEntryPath, previewType } from '../shared/attachments.js'
import { connectionAnchor, connectionGeometry, connectionSides } from '../shared/connections.js'
import { diagramSource, parseDiagram, diagramTemplates } from '../shared/diagram-builder.js'
import { validateDiagramSource } from '../shared/rich-content.js'
import { validNotebook } from '../shared/validation.js'
import { createFieldnotesServer } from '../server.mjs'

const fileEntry = (name, contents = name) => ({ name, isFile: true, isDirectory: false, file: (resolve) => queueMicrotask(() => resolve(new File([contents], name))) })
const directory = (name, batches) => ({ name, isFile: false, isDirectory: true, createReader() {
  let index = 0
  return { readEntries: (resolve) => queueMicrotask(() => resolve(batches[index++] || [])) }
} })
test('dropping folders reads every directory batch and preserves nested and empty directories', async () => {
  const root = directory('项目资料', [Array.from({ length: 100 }, (_, i) => fileEntry(`${i}.dat`)), [directory('空目录', []), directory('子目录', [[fileEntry('中文.txt', '完整内容')]])], [fileEntry('最后一个.bin')]])
  let reads = 0
  const promise = collectDrop({ items: [{ kind: 'file', webkitGetAsEntry: () => { reads++; return root }, getAsFile: () => null }], files: [] })
  assert.equal(reads, 1, 'the drop store must be read before the event returns')
  const [group] = await promise
  assert.equal(group.name, '项目资料')
  assert.equal(group.entries.filter((entry) => entry.file).length, 102)
  assert.ok(group.entries.some((entry) => entry.path === '空目录' && !entry.file))
  assert.equal(await group.entries.find((entry) => entry.path === '子目录/中文.txt').file.text(), '完整内容')
  assert.equal(group.entries.at(-1).path, '最后一个.bin')
})

test('folder picker groups roots, retains parent paths and accepts all file types', () => {
  const picked = (relative) => { const file = new File(['bytes'], relative.split('/').at(-1)); Object.defineProperty(file, 'webkitRelativePath', { value: relative }); return file }
  const groups = groupPickedFiles([picked('甲/设计/源文件.unknown'), picked('甲/说明.txt'), picked('乙/照片.png'), new File(['binary'], '任意文件.exe')])
  assert.deepEqual(groups.map((group) => [group.name, group.folder]), [['甲', true], ['乙', true], ['任意文件.exe', false]])
  assert.deepEqual(groups[0].entries.map((entry) => entry.path), ['设计', '设计/源文件.unknown', '说明.txt'])
  assert.equal(previewType('说明.md'), 'text')
  assert.equal(previewType('预算.xlsx'), 'office')
  assert.equal(previewType('任意文件.exe'), 'binary')
  assert.equal(previewType('页面.html'), 'text', 'HTML is displayed as text')
})

test('partial import retains successful files and records failures honestly in the folder', async () => {
  const stored = new Map(), progress = []
  const { notes, errors } = await importAssets([{ name: '资料', folder: true, entries: [{ path: '空文件夹' }, { path: '成功.txt', file: new File(['成功正文'], '成功.txt') }, { path: '失败.bin', file: new File(['bad'], '失败.bin') }] }], { x: 4, y: 7 }, async (id, blob) => {
    if (await blob.text() === 'bad') throw new Error('磁盘写入失败')
    stored.set(id, blob)
  }, (value) => progress.push(value))
  assert.equal(notes.length, 1)
  assert.equal(errors.length, 1)
  assert.equal(assetIdsForNote(notes[0]).length, 1)
  assert.equal(await stored.get(notes[0].entries[1].assetId).text(), '成功正文')
  assert.equal(notes[0].entries[2].error, '磁盘写入失败')
  assert.equal(notes[0].entries[2].assetId, undefined)
  assert.deepEqual(progress.at(-1), { done: 2, total: 2, name: '失败.bin' })
  const notebook = initialNotebook(); notebook.boards[0].notes.push(...notes)
  assert.ok(validNotebook(notebook))
  const tooLarge = new File([], '大文件.bin'); Object.defineProperty(tooLarge, 'size', { value: 101 * 1024 * 1024 })
  const result = await importAssets(groupPickedFiles([tooLarge]), { x: 0, y: 0 }, () => assert.fail('oversize files must be rejected before uploading'), () => {})
  assert.equal(result.notes.length, 0); assert.match(result.errors[0], /100 MB/)
})

test('folder paths reject traversal, duplicate entries, missing parents and invalid attachment IDs', () => {
  for (const path of ['../x', 'C:/x', 'dir/../x', 'a\\b', '/root', 'dir//file', './file']) assert.equal(validEntryPath(path), false, path)
  const notebook = initialNotebook(), folder = makeNote('folder', 1, 2)
  notebook.boards[0].notes.push(folder)
  for (const entries of [[{ path: '../bad', kind: 'directory' }], [{ path: 'a', kind: 'directory' }, { path: 'a', kind: 'directory' }], [{ path: 'a/x', kind: 'file', assetId: 'id' }], [{ path: 'bad', kind: 'file', assetId: '../x' }]]) {
    folder.entries = entries; assert.equal(validNotebook(notebook), false)
  }
  folder.entries = [{ path: 'a', kind: 'directory' }, { path: 'a/x', kind: 'file', assetId: 'id' }]
  assert.equal(validNotebook(notebook), true)
})

test('folder attachments, empty files and styled connections survive server restart and backup ID remapping', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'own-authoring-'))
  let server, url
  const start = async () => { server = await createFieldnotesServer({ dataDir: root }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); url = `http://127.0.0.1:${server.address().port}` }
  const close = async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) }
  t.after(async () => { await close(); assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir())); assert.ok(path.basename(root).startsWith('own-authoring-')); await rm(root, { recursive: true, force: true }) })
  await start()
  const originals = new Map()
  const store = async (id, blob) => { const bytes = Buffer.from(await blob.arrayBuffer()); originals.set(id, bytes); const response = await fetch(url + '/api/assets/' + id, { method: 'PUT', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: bytes }); assert.equal(response.status, 200) }
  const { notes } = await importAssets([{ name: '完整项目', folder: true, entries: [{ path: 'empty', }, { path: 'nested' }, { path: 'nested/raw.unknown', file: new File([new Uint8Array([0, 255, 14, 0, 8])], 'raw.unknown') }, { path: 'nested/说明.md', file: new File(['# 中文正文\n\n尾部也必须保留。'], '说明.md') }, { path: '零字节.txt', file: new File([], '零字节.txt') }] }], { x: 100, y: 200 }, store, () => {})
  const notebook = initialNotebook(), board = notebook.boards[0]; board.notes.push(...notes)
  board.connections.push({ id: 'styled-edge', from: board.notes[0].id, to: notes[0].id, label: '参考资料', style: 'elbow', arrow: 'both', dashed: true, color: '#397aa5', fromSide: 'bottom', toSide: 'top' })
  const empty = await fetch(url + '/api/notebook')
  assert.equal((await fetch(url + '/api/notebook', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': empty.headers.get('etag') }, body: JSON.stringify(notebook) })).status, 200)
  await close(); await start()
  assert.deepEqual((await (await fetch(url + '/api/notebook')).json()).notebook, notebook)
  const ids = assetIdsForNote(notes[0]); assert.equal(ids.length, 3)
  const backup = { note: notes[0], assets: {} }
  for (const id of ids) { const bytes = Buffer.from(await (await fetch(url + '/api/assets/' + id)).arrayBuffer()); assert.deepEqual(bytes, originals.get(id)); backup.assets[id] = bytes.toString('base64') }
  const decoded = JSON.parse(JSON.stringify(backup)), remap = new Map(ids.map((id, i) => [id, `restored-${i}`]))
  const restored = remapNoteAssets(decoded.note, remap)
  for (const id of ids) await store(remap.get(id), new Blob([Buffer.from(decoded.assets[id], 'base64')]))
  assert.deepEqual(restored.entries.filter((entry) => entry.kind === 'directory'), notes[0].entries.filter((entry) => entry.kind === 'directory'))
  assert.deepEqual(assetIdsForNote(restored), [...remap.values()])
  for (const id of ids) assert.deepEqual(Buffer.from(await (await fetch(url + '/api/assets/' + remap.get(id))).arrayBuffer()), Buffer.from(decoded.assets[id], 'base64'))
})

test('Office content previews extract DOCX text/tables, sparse XLSX cells and ordered slides from the original archives', (t) => {
  const previous = globalThis.DOMParser, dom = new JSDOM('')
  globalThis.DOMParser = dom.window.DOMParser; t.after(() => { globalThis.DOMParser = previous; dom.window.close() })
  const archive = (files) => zipSync(Object.fromEntries(Object.entries(files).map(([name, xml]) => [name, strToU8(xml)])))
  const docx = readOffice(archive({ 'word/document.xml': '<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>完整中文正文</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格内容</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>' }), 'docx')
  assert.equal(docx[0].text, '完整中文正文'); assert.deepEqual(docx[1].rows, [['表格内容']])
  const xlsx = readOffice(archive({ 'xl/workbook.xml': '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="预算" r:id="r1"/></sheets></workbook>', 'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>', 'xl/sharedStrings.xml': '<sst><si><t>项目甲</t></si></sst>', 'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><v>123.45</v></c></row></sheetData></worksheet>' }), 'xlsx')
  assert.match(xlsx[0].title, /预算/); assert.deepEqual(xlsx[0].rows, [['项目甲', '', '123.45']])
  const pptx = readOffice(archive({ 'ppt/slides/slide10.xml': '<s><p><t>第十页内容</t></p></s>', 'ppt/slides/slide2.xml': '<s><p><t>第二页内容</t></p></s>' }), 'pptx')
  assert.deepEqual(pptx.map((part) => part.text), ['第二页内容', '第十页内容'])
  assert.throws(() => readOffice(archive({ 'word/document.xml': '<broken' }), 'docx'), /解析/)
})

test('connections anchor to all four sides, follow moved cards and generate straight, curved or orthogonal paths', () => {
  const from = { x: 10, y: 20, width: 300, height: 200 }, to = { x: 500, y: 440, width: 250, height: 160 }
  assert.deepEqual(connectionAnchor(from, 'bottom'), { x: 160, y: 225 })
  for (const side of connectionSides) for (const style of ['curve', 'straight', 'elbow']) {
    const geometry = connectionGeometry(from, to, { style, fromSide: side, toSide: 'top' })
    assert.deepEqual(geometry.a, connectionAnchor(from, side)); assert.deepEqual(geometry.b, connectionAnchor(to, 'top'))
    assert.ok(Number.isFinite(geometry.label.x) && Number.isFinite(geometry.label.y)); assert.doesNotMatch(geometry.path, /NaN|undefined/)
    if (style === 'elbow') { const numbers = geometry.path.match(/-?\d+(?:\.\d+)?/g).map(Number); for (let i = 2; i < numbers.length; i += 2) assert.ok(numbers[i] === numbers[i - 2] || numbers[i + 1] === numbers[i - 1]) }
  }
  assert.notEqual(connectionGeometry(from, to).path, connectionGeometry({ ...from, x: 55 }, to).path)
})

test('diagram forms preserve Chinese labels and punctuation, validate in Mermaid and leave advanced source untouched', async (t) => {
  const dom = new JSDOM(''), previousWindow = globalThis.window, previousDocument = globalThis.document
  globalThis.window = dom.window; globalThis.document = dom.window.document
  t.after(() => { globalThis.window = previousWindow; globalThis.document = previousDocument; dom.window.close() })
  const { default: mermaid } = await import('mermaid'); mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
  for (const graph of Object.values(diagramTemplates)) {
    const draft = structuredClone(graph)
    draft.nodes[0].label = '中文 "引号" [括号] #35; & <文字> \\ | `code`\nclick node https://test'
    draft.edges[0].label = '是 | 否 "条件"'
    for (const dashed of [true, false]) for (const arrow of [true, false]) {
      draft.edges[0].dashed = dashed; draft.edges[0].arrow = arrow
      const source = diagramSource(draft)
      assert.deepEqual(parseDiagram(source), draft)
      validateDiagramSource(source)
      assert.ok(await mermaid.parse(source))
    }
  }
  for (const source of ['sequenceDiagram\nA->>B: 内容', 'flowchart LR\nA[高级节点] --> B', diagramSource(diagramTemplates.flow) + '\nclassDef special fill:red']) assert.equal(parseDiagram(source), null)
})
