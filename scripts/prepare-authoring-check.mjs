import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { makeBoard, makeNote } from '../src/model.ts'

const root = fileURLToPath(new URL(`../artifacts/authoring-check/run-${Date.now()}/`, import.meta.url))
const source = path.join(root, '项目资料'), workspace = path.join(root, 'workspace')
for (const directory of [workspace, source, path.join(source, '文档'), path.join(source, '空目录')]) await mkdir(directory, { recursive: true })
await writeFile(path.join(source, '阅读说明.md'), '# 项目资料\n\n这份资料完整保存在 Own 中。\n\n- 保留子目录\n- 文件可预览和另存为\n\n尾部核对：完整内容。', 'utf8')
await writeFile(path.join(source, '原始数据.custom'), new Uint8Array([0, 1, 255, 8, 32, 0, 4]))
await writeFile(path.join(source, '文档', '任务.csv'), '任务,状态\n设计,完成\n验证,进行中\n', 'utf8')
await writeFile(path.join(source, '文档', '公式.tex'), '\\int_0^1 x^2\\,dx=\\frac{1}{3}', 'utf8')
await writeFile(path.join(source, '文档', '工作流程.mmd'), 'flowchart LR\nA[导入资料] --> B[组织笔记] --> C[执行任务]', 'utf8')
const docx = zipSync(Object.fromEntries(Object.entries({
  '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  'word/document.xml': '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>项目会议记录</w:t></w:r></w:p><w:p><w:r><w:t>文件夹中的 Word 文档可以直接查看文字与表格。</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>负责人</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>小林</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
}).map(([name, contents]) => [name, strToU8(contents)])))
await writeFile(path.join(source, '文档', '会议记录.docx'), docx)
const board = makeBoard('功能验收 · 独立测试笔记', 'blank')
board.description = '测试文件夹、卡片连线、可视公式与流程图。'
board.notes = [{ ...makeNote('text', 100, 60), title: '项目目标', body: '把信息放在一起，连起来，再开始行动。' }, { ...makeNote('text', 560, 100), title: '执行计划', body: '在卡片边缘拖出连线，说明两者之间的关系。' }]
await writeFile(path.join(workspace, 'notebook.json'), JSON.stringify({ version: 1, workspaceVersion: 1, boards: [board], activeBoardId: board.id }))
await writeFile(new URL('../artifacts/authoring-check/latest.json', import.meta.url), JSON.stringify({ root, source, workspace, profile: path.join(root, 'profile'), state: path.join(root, 'state') }, null, 2))
console.log(JSON.stringify({ root, source, workspace }))
