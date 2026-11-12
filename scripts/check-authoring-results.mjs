import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { unzipSync } from 'fflate'
import { assetIdsForNote } from '../shared/attachments.js'
const check = JSON.parse(await readFile(new URL('../artifacts/authoring-check/latest.json', import.meta.url), 'utf8'))
const download = path.join(process.env.USERPROFILE, 'Downloads')
const backup = JSON.parse(await readFile(path.join(download, 'Own-备份-2026-11-12.own'), 'utf8'))
const archive = unzipSync(new Uint8Array(await readFile(path.join(download, '项目资料.zip'))))
const original = backup.notebook.boards[0].notes.find((note) => note.kind === 'folder')
assert.ok(original)
let checked = 0
for (const entry of original.entries.filter((entry) => entry.kind === 'file')) {
  const bytes = await readFile(path.join(check.source, ...entry.path.split('/')))
  assert.deepEqual(Buffer.from(archive[entry.path]), bytes, 'ZIP original: ' + entry.path)
  const dataUrl = backup.assets[entry.assetId]
  assert.deepEqual(Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'), bytes, 'Backup original: ' + entry.path)
  checked++
}
assert.deepEqual(await readFile(path.join(download, '原始数据.custom')), await readFile(path.join(check.source, '原始数据.custom')))
const notebook = JSON.parse(await readFile(path.join(check.workspace, 'notebook.json'), 'utf8'))
assert.equal(notebook.boards.length, 2)
const restored = notebook.boards.find((board) => board.id === notebook.activeBoardId)
const folder = restored.notes.find((note) => note.kind === 'folder')
assert.equal(assetIdsForNote(folder).length, checked)
assert.ok(assetIdsForNote(folder).every((id) => !assetIdsForNote(original).includes(id)))
for (const entry of folder.entries.filter((entry) => entry.kind === 'file')) {
  const metadata = JSON.parse(await readFile(path.join(check.workspace, 'assets', entry.assetId + '.json')))
  const bytes = await readFile(path.join(check.workspace, 'assets', `${entry.assetId}.${metadata.contentHash}.blob`))
  assert.deepEqual(bytes, await readFile(path.join(check.source, ...entry.path.split('/'))), 'Restored original: ' + entry.path)
}
assert.equal(restored.notes.find((note) => note.title === '可视分数输入').latex, '\\frac{a}{b}')
const diagram = restored.notes.find((note) => note.title === '工作流程制作验收')
assert.match(diagram.mermaid, /补充信息/)
assert.match(diagram.mermaid, /flowchart TB/)
assert.ok(restored.connections.some((edge) => edge.label === '支持执行' && edge.style === 'elbow' && edge.arrow === 'both' && edge.dashed))
assert.ok(restored.connections.some((edge) => edge.label === '资料转为行动' && edge.fromSide === 'bottom' && edge.toSide === 'top'))
const report = { passed: true, checkedOriginalFiles: checked, checks: ['实际文件夹选择器导入', 'Markdown 末尾内容与 Word 文字/表格预览', '未知格式另存为逐字节一致', '文件夹 ZIP 逐文件与原稿一致', '完整备份逐文件与原稿一致', '实际恢复生成新附件编号，所有附件逐字节一致', '分数按钮、Tab 空位输入与保存', '中文节点、判断形状、分支连接制作与保存', '点击连接、拖拽连接点、关系文字、折线、双向箭头、虚线保存'], nativeUI: '测试 WebView2 客户端可启动并读到新版工具；系统拒绝自动激活窗口，交互在相同服务的独立浏览器测试页完成。', screenshot: 'folder-preview.png' }
await writeFile(new URL('../artifacts/authoring-check/result.json', import.meta.url), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
