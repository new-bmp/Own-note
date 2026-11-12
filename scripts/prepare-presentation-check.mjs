import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { makeBoard, makeNote } from '../src/model.ts'

const root = fileURLToPath(new URL(`../artifacts/presentation-check/run-${Date.now()}/`, import.meta.url))
const workspace = path.join(root, 'workspace')
await mkdir(workspace, { recursive: true })
const board = makeBoard('子画布与演讲 · 独立验收', 'blank')
board.description = '全屏只读汇报，临时拖动布局不会保存。'
const child = { ...makeBoard('项目详情', 'blank'), parentBoardId: board.id }
const nested = { ...makeBoard('原始依据', 'blank'), parentBoardId: child.id }
const text = { ...makeNote('markdown', 0, 0), width: 420, height: 300, title: '一次汇报，逐层展开', body: '## 本次交付\n\n- 子画布可以继续嵌套\n- 笔记与附件共用存储\n- 演讲布局临时调整\n- 双击查看只读详情\n\n' + '详细依据与结果均完整保留。\n\n'.repeat(60) + '**正文结尾：完整。**' }
const portal = { ...makeNote('board', 460, 0), childBoardId: child.id }
const formula = { ...makeNote('latex', 0, 340), width: 420, height: 260, title: '公式与解释', latex: '\\bar{x}=\\frac{1}{n}\\sum_{i=1}^{n}x_i', caption: '所有观测值的算术平均数。' }
const chart = { ...makeNote('chart', 460, 340), width: 400, height: 300, title: '验收进度', chart: { type: 'bar', labels: ['模型', '界面', '回归测试'], series: [{ name: '已完成', values: [3, 4, 6] }], unit: '项' } }
const code = { ...makeNote('code', 910, 0), width: 480, height: 640, title: '代码与已保存结果', cells: [{ id: 'python', language: 'python', code: 'values = [3, 5, 8]\nprint(sum(values))', stdin: '', expected: '16\n', output: '16\n' }, { id: 'cpp', language: 'cpp', code: '#include <iostream>\nint main() { std::cout << "Own"; }', stdin: '', expected: 'Own', output: 'Own' }] }
board.notes = [text, portal, formula, chart, code]
board.connections = [{ id: 'report-details', from: text.id, to: portal.id, label: '展开依据', style: 'curve', arrow: 'end' }]
child.notes = [{ ...makeNote('board', 0, 0), childBoardId: nested.id }, { ...makeNote('text', 450, 0), title: '共享工作空间', body: '子画布记录在同一 notebook 中。\n入口只保存子画布 ID，不复制笔记或文件。' }, { ...makeNote('analysis', 0, 360), title: '真实原始数据' }]
nested.notes = [{ ...makeNote('text', 0, 0), title: '第三层内容', body: '演讲中可在各层导航。\n退出演讲后，每层的位置都恢复。' }]
const notebook = { version: 1, workspaceVersion: 1, boards: [board, child, nested], activeBoardId: board.id }
await writeFile(path.join(workspace, 'notebook.json'), JSON.stringify(notebook))
await writeFile(path.join(root, 'original.json'), JSON.stringify(notebook))
const check = { root, workspace, profile: path.join(root, 'profile'), state: path.join(root, 'state'), boardId: board.id, noteId: text.id }
await writeFile(new URL('../artifacts/presentation-check/latest.json', import.meta.url), JSON.stringify(check, null, 2))
console.log(JSON.stringify(check))
