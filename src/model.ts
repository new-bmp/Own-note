import { diagramSource, diagramTemplates } from '../shared/diagram-builder.js'
import { migrateAgentProjects } from '../shared/agent-workspace.js'

export type NoteKind =
  | 'board'
  | 'text'
  | 'sticky'
  | 'image'
  | 'checklist'
  | 'table'
  | 'file'
  | 'folder'
  | 'link'
  | 'markdown'
  | 'latex'
  | 'diagram'
  | 'chart'
  | 'program'
  | 'code'
  | 'analysis'
  | 'concept'
export type Tool =
  | 'select'
  | 'hand'
  | 'connect'
  | 'text'
  | 'sticky'
  | 'table'
  | 'checklist'

export interface TaskItem {
  id: string
  text: string
  done: boolean
  priority?: 'high' | 'medium' | 'low'
  dueDate?: string
  owner?: string
}

export interface ChartSpec {
  type: 'bar' | 'line' | 'pie'
  labels: string[]
  series: { name: string; values: number[]; color?: string }[]
  unit?: string
}

export interface NoteSource {
  requestId: string
  section: string
  createdAt: string
  agent?: string
  conversationId?: string
  url?: string
  fingerprint?: string
}

export interface ConversationCapture {
  requestId: string
  fingerprint: string
  title: string
  summary: string
  createdAt: string
  source?: Pick<NoteSource, 'agent' | 'conversationId' | 'url'>
  noteIds: string[]
  content?: {
    markdown?: string
    markdownNoteIds?: string[]
    received: {
      summaryCharacters: number
      markdownCharacters: number
      sectionCharacters: number
      transcriptCharacters: number
      sections: number
      decisions: number
      actions: number
      openQuestions: number
      references: number
      equations: number
      diagrams: number
      charts: number
    }
    manifest: { id: string; contentHash: string }[]
  }
}

export type BoardTemplate = 'blank' | 'project' | 'meeting'

export interface FolderEntry {
  path: string
  kind: 'file' | 'directory'
  assetId?: string
  size?: number
  mime?: string
  modifiedAt?: number
  error?: string
}

export interface CodeCell { id: string; language: string; code: string; stdin: string; expected?: string; output?: string; error?: string; exitCode?: number; executedAt?: number; executedCode?: string; executedLanguage?: string; executedInput?: string; executionCount?: number }
export interface WebInteraction { mode: 'preview' | 'interactive'; approvedOrigin?: string; approvedAt?: number }
export type ProgramDriverType = 'tcp' | 'serial-lan' | 'udp' | 'websocket'
export interface ProgramDriver {
  id: string
  name?: string
  type: ProgramDriverType
  host?: string
  port?: number
  baudRate?: number
  encoding?: 'utf8' | 'base64'
  enabled?: boolean
  approvedAt?: number
}
export interface ProgramFrame { at: number; values: Record<string, string | number | boolean> }
export interface ProgramAnimation {
  width: number
  height: number
  durationMs: number
  loop: boolean
  frames: ProgramFrame[]
}
export interface ProgramApp {
  framework: 'flask'
  enabled: boolean
  entryCellId?: string
  port?: number
}
export interface ConceptState { planId: string; status: 'pending' | 'running' | 'done' | 'blocked' | 'paused'; acceptance: string; dependsOn: string[]; agentId?: string; progress?: string; evidence?: string; nextAction?: string; blockers?: string[]; artifactIds?: string[]; checkpointId?: string; lease?: { token: string; revision: string; projectRevision?: string; expiresAt: number }; history?: { at: number; text: string }[] }
export interface AgentBrief { goal: string; scope: string; constraints: string; acceptance: string; paused: boolean; allowCode: boolean; allowMedia: boolean }
export interface AgentPresence { id: string; name: string; lastSeenAt: number; currentNoteId?: string; summary?: string }
export interface AnalysisSettings {
  filter?: { column: number; operator: string; value: string }
  sort?: { column: number; ascending: boolean }
  group?: number
  value?: number
  method?: string
  chartType?: 'bar' | 'line' | 'pie'
  order?: 'source' | 'value' | 'label'
}

export interface CanvasNote {
  childBoardId?: string
  id: string
  kind: NoteKind
  x: number
  y: number
  width: number
  height: number
  title?: string
  body?: string
  color?: string
  label?: string
  src?: string
  assetId?: string
  filename?: string
  size?: number
  mime?: string
  url?: string
  columns?: string[]
  rows?: string[][]
  items?: TaskItem[]
  latex?: string
  mermaid?: string
  caption?: string
  chart?: ChartSpec
  source?: NoteSource
  entries?: FolderEntry[]
  modelPath?: string
  mediaSettings?: { speed: number; volume: number; loop: boolean; start: number; marks: { time: number; label: string }[] }
  modelSettings?: { wireframe: boolean; grid: boolean; autoRotate: boolean }
  analysisOrigin?: { noteId: string; contentHash: string; settings: AnalysisSettings; rows: number; totalGroups: number }
  cells?: CodeCell[]
  webInteraction?: WebInteraction
  programDrivers?: ProgramDriver[]
  animation?: ProgramAnimation
  programApp?: ProgramApp
  analysisSource?: string
  analysisFormat?: 'csv' | 'tsv' | 'json'
  analysisSettings?: AnalysisSettings
  concept?: ConceptState
}

export interface Connection {
  id: string
  from: string
  to: string
  label?: string
  style?: 'curve' | 'straight' | 'elbow'
  arrow?: 'end' | 'both' | 'none'
  dashed?: boolean
  color?: string
  fromSide?: 'top' | 'right' | 'bottom' | 'left'
  toSide?: 'top' | 'right' | 'bottom' | 'left'
}
export interface Board {
  parentBoardId?: string
  creationRequest?: { requestId: string; fingerprint: string }
  executionReceipts?: { requestId: string; kind: 'code' | 'program' | 'debug' | 'media'; fingerprint: string; at: number }[]
  id: string
  title: string
  description: string
  icon:
    | 'leaf'
    | 'sun'
    | 'book'
    | 'sparkles'
    | 'project'
    | 'meeting'
    | 'resources'
  favorite: boolean
  updatedAt: number
  lastOpenedAt?: number
  trashed?: boolean
  notes: CanvasNote[]
  connections: Connection[]
  captures?: ConversationCapture[]
  agents?: AgentPresence[]
  legacyBoardId?: string
  agentBrief?: AgentBrief
}
export interface Appearance {
  accent: string
  canvas: string
}

export interface Notebook {
  version: 1
  boards: Board[]
  activeBoardId: string
  workspaceVersion?: 1
  appearance?: Appearance
  agentProjects?: Board[]
  activeAgentProjectId?: string
  appMode?: 'notes' | 'agents'
}
export interface Viewport {
  x: number
  y: number
  zoom: number
}

export const uid = () => crypto.randomUUID()

export function makeNote(kind: NoteKind, x: number, y: number): CanvasNote {
  const base = { id: uid(), kind, x, y }
  switch (kind) {
    case 'board':
      return { ...base, width: 400, height: 300, title: '子画布', body: '双击进入，共用工作空间存储。' }
    case 'code':
      return { ...base, width: 560, height: 420, title: '代码实验笔记', body: '修改代码与输入，运行并比较输出。', cells: [{ id: uid(), language: 'javascript', code: 'const input = await new Promise(resolve => { let text = ""; process.stdin.on("data", chunk => text += chunk); process.stdin.on("end", () => resolve(text)); });\nconst numbers = input.trim().split(/\\s+/).map(Number);\nconsole.log(numbers.reduce((sum, value) => sum + value, 0));', stdin: '3 5 8', expected: '16\n' }] }
    case 'program':
      return { ...base, width: 620, height: 560, title: '可编程块', body: '按单元运行代码、观察变量，连接设备、制作动画或启动 Flask 应用。', cells: [{ id: uid(), language: 'javascript', code: 'const input = await new Promise(resolve => { let text = ""; process.stdin.on("data", chunk => text += chunk); process.stdin.on("end", () => resolve(text)); });\nconst numbers = input.trim().split(/\\s+/).map(Number);\nconsole.log(numbers.reduce((sum, value) => sum + value, 0));', stdin: '3 5 8', expected: '16\n' }], programDrivers: [], animation: { width: 640, height: 360, durationMs: 3000, loop: true, frames: [{ at: 0, values: { x: 0, y: 0, opacity: 1 } }, { at: 3000, values: { x: 320, y: 180, opacity: 1 } }] }, programApp: { framework: 'flask', enabled: false } }
    case 'analysis':
      return { ...base, width: 520, height: 360, title: '数据分析', analysisFormat: 'csv', analysisSource: '日期,类别,金额\n2026-11-01,设计,120\n2026-11-02,开发,350\n2026-11-03,设计,180\n2026-11-04,开发,420' }
    case 'concept':
      return { ...base, width: 440, height: 380, title: '下一步构想', body: '描述目标、范围、约束，以及需要交付的结果。', concept: { planId: uid(), status: 'pending', acceptance: '列出可验证的完成标准。', dependsOn: [] } }
    case 'markdown':
      return {
        ...base,
        width: 400,
        height: 320,
        title: '结构化笔记',
        label: 'Markdown',
        body: '## 核心结论\n\n写下背景、结论与下一步。\n\n- 支持 **重点**、表格与公式\n- 双击卡片编辑源码',
      }
    case 'latex':
      return {
        ...base,
        width: 420,
        height: 245,
        title: 'LaTeX 公式',
        latex:
          'P = \\frac{N_{\\mathrm{done}}}{N_{\\mathrm{total}}} \\times 100\\%',
        caption: '任务完成率 = 已完成任务数 ÷ 总任务数。总任务数须大于零。',
      }
    case 'diagram':
      return {
        ...base,
        width: 500,
        height: 370,
        title: '流程图',
        mermaid: diagramSource(diagramTemplates.flow),
        caption: '把过程和关系画出来。双击添加节点与连接。',
      }
    case 'chart':
      return {
        ...base,
        width: 500,
        height: 360,
        title: '数据图表',
        chart: {
          type: 'bar',
          labels: ['事项 A', '事项 B', '事项 C'],
          series: [{ name: '示例数值', values: [3, 5, 2] }],
          unit: '项',
        },
        caption: '示例数据，请替换为你的真实数据。',
      }
    case 'text':
      return {
        ...base,
        width: 310,
        height: 190,
        title: '未命名笔记',
        body: '双击编辑，记录背景、结论或下一步行动。',
        label: '工作笔记',
      }
    case 'sticky':
      return {
        ...base,
        width: 240,
        height: 210,
        title: '快速记录',
        body: '在这里记录要点、\n问题或待确认事项。',
        color: '#f3edb6',
      }
    case 'checklist':
      return {
        ...base,
        width: 310,
        height: 245,
        title: '待办任务',
        label: '待办清单',
        items: [
          { id: uid(), text: '明确任务目标', done: false },
          { id: uid(), text: '确认下一步行动', done: false },
        ],
      }
    case 'table':
      return {
        ...base,
        width: 380,
        height: 240,
        title: '项目跟进',
        columns: ['事项', '状态', '负责人'],
        rows: [
          ['确认需求范围', '待开始', '我'],
          ['整理执行方案', '进行中', '我'],
        ],
      }
    case 'link':
      return {
        ...base,
        width: 260,
        height: 125,
        title: '参考链接',
        url: 'https://example.com',
        body: 'EXAMPLE.COM',
      }
    case 'image':
      return { ...base, width: 350, height: 275, title: '参考图片' }
    case 'file':
      return {
        ...base,
        width: 260,
        height: 132,
        filename: '附件',
        title: '附件',
      }
    case 'folder':
      return { ...base, width: 340, height: 310, title: '文件夹', entries: [] }
  }
}

export function makeBoard(
  title: string,
  template: BoardTemplate = 'blank',
): Board {
  if (template === 'project') return { ...projectBoard(), id: uid(), title }
  if (template === 'meeting') return { ...meetingBoard(), id: uid(), title }
  return {
    id: uid(),
    title,
    description: '在同一处整理笔记、任务和项目资料。',
    icon: 'sparkles',
    favorite: false,
    updatedAt: Date.now(),
    notes: [],
    connections: [],
  }
}

export function workDate(offset = 0): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + offset)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const value = (type: string) => parts.find((p) => p.type === type)!.value
  return `${value('year')}-${value('month')}-${value('day')}`
}

export function projectBoard(): Board {
  return {
    id: 'work-launch',
    title: '产品迭代 · v2.4',
    description: '从需求到交付，把上下文放在一起。',
    icon: 'project',
    favorite: true,
    updatedAt: Date.now(),
    notes: [
      {
        id: 'work-brief',
        kind: 'text',
        x: 0,
        y: 0,
        width: 318,
        height: 220,
        label: '项目概览',
        title: '让信息流动更高效',
        body: '目标：缩短从记录到行动的路径。\n范围：统一搜索、任务跟进与资料归档。\n交付：本周完成核心流程验证。',
      },
      {
        id: 'work-tasks',
        kind: 'checklist',
        x: 354,
        y: 0,
        width: 338,
        height: 282,
        label: '本周执行',
        title: '让计划向前一步',
        items: [
          {
            id: 'work-task-1',
            text: '梳理核心使用场景',
            done: true,
            priority: 'high',
            dueDate: workDate(),
          },
          {
            id: 'work-task-2',
            text: '完成交互方案评审',
            done: false,
            priority: 'high',
            dueDate: workDate(),
          },
          {
            id: 'work-task-3',
            text: '整理开发交付清单',
            done: false,
            priority: 'medium',
            dueDate: workDate(1),
          },
          {
            id: 'work-task-4',
            text: '补充边界情况与验收标准',
            done: false,
            priority: 'medium',
            dueDate: workDate(2),
          },
        ],
      },
      {
        id: 'work-decision',
        kind: 'sticky',
        x: 728,
        y: 0,
        width: 252,
        height: 184,
        title: '待确认',
        body: '首版先聚焦核心流程。\n批量操作放到下一轮？',
        label: '下次评审时确认',
        color: '#fff5d9',
      },
      {
        id: 'work-meeting',
        kind: 'text',
        x: 0,
        y: 250,
        width: 318,
        height: 260,
        label: '会议记录 / 产品例会',
        title: '结论与下一步',
        body: '01  搜索入口统一，减少切换成本。\n02  任务关联原始笔记，保留上下文。\n03  所有文件集中收纳，便于查找。\n\n下一步：评审通过后进入开发排期。',
      },
      {
        id: 'work-milestones',
        kind: 'table',
        x: 354,
        y: 312,
        width: 338,
        height: 238,
        title: '里程碑与交付',
        columns: ['交付事项', '状态', '负责人'],
        rows: [
          ['需求范围确认', '已完成', '我'],
          ['核心流程评审', '进行中', '我'],
          ['开发交付与验收', '待开始', '我'],
        ],
      },
      {
        id: 'work-reference',
        kind: 'image',
        x: 728,
        y: 215,
        width: 252,
        height: 174,
        title: '信息架构草图',
        label: '设计参考 · 可双击预览',
        src: '/images/workflow.svg',
      },
      {
        id: 'work-file',
        kind: 'file',
        x: 728,
        y: 419,
        width: 252,
        height: 131,
        title: '产品迭代需求说明.md',
        filename: '产品迭代需求说明.md',
        src: '/project-brief.md',
        mime: 'text/markdown',
        size: 710,
      },
    ],
    connections: [
      { id: 'work-edge-1', from: 'work-brief', to: 'work-tasks' },
      { id: 'work-edge-2', from: 'work-tasks', to: 'work-decision' },
    ],
  }
}

export function meetingBoard(): Board {
  return {
    id: 'work-meetings',
    title: '会议与决策',
    description: '记录讨论结论，让每个行动项都有着落。',
    icon: 'meeting',
    favorite: false,
    updatedAt: Date.now() - 3600000,
    notes: [
      {
        ...makeNote('text', 0, 0),
        width: 360,
        height: 250,
        label: '会议记录',
        title: '本次讨论',
        body: '会议主题：\n参会人员：\n\n讨论要点\n1. \n2. \n\n决策与结论：',
      },
      {
        ...makeNote('checklist', 400, 0),
        width: 340,
        height: 250,
        label: '会后跟进',
        title: '行动清单',
        items: [
          {
            id: uid(),
            text: '整理并确认会议结论',
            done: false,
            priority: 'medium',
          },
          {
            id: uid(),
            text: '确认行动项与截止日期',
            done: false,
            priority: 'high',
          },
        ],
      },
      {
        ...makeNote('sticky', 0, 288),
        width: 360,
        height: 160,
        title: '待讨论的问题',
        body: '需要补充的信息：\n需要谁来确认：',
        label: '下次会议前更新',
        color: '#edf0ff',
      },
    ],
    connections: [],
  }
}

export function initialNotebook(): Notebook {
  return {
    version: 1,
    workspaceVersion: 1,
    activeBoardId: 'work-launch',
    boards: [
      projectBoard(),
      meetingBoard(),
      {
        id: 'work-resources',
        title: '资料与参考',
        description: '按项目收集文档、图片与外部链接。',
        icon: 'resources',
        favorite: false,
        updatedAt: Date.now() - 7200000,
        notes: [
          {
            ...makeNote('text', 0, 0),
            width: 360,
            height: 210,
            title: '把项目资料放在一起',
            label: '资料索引',
            body: '把文件或图片拖入画布，随时打开预览。\n复制链接后直接粘贴，自动生成链接卡片。\n切换「资料库」集中查找所有附件。',
          },
          {
            ...makeNote('link', 410, 0),
            title: 'MDN Web 文档',
            url: 'https://developer.mozilla.org/zh-CN/',
            body: 'DEVELOPER.MOZILLA.ORG',
          },
          {
            ...makeNote('file', 410, 160),
            filename: '产品迭代需求说明.md',
            title: '产品迭代需求说明.md',
            src: '/project-brief.md',
            size: 710,
            mime: 'text/markdown',
          },
        ],
        connections: [],
      },
    ],
  }
}

export function upgradeWorkspace(notebook: Notebook): Notebook {
  notebook=migrateAgentProjects(notebook)
  let migrated = notebook
  const migratePrograms = (board: Board): Board => {
    let changed = false
    const notes = board.notes.map(note => {
      if (note.kind !== 'code') return note
      changed = true
      return { ...note, kind: 'program' as NoteKind, title: note.title === '代码实验笔记' ? '可编程块' : note.title }
    })
    return changed ? { ...board, notes } : board
  }
  const boards = notebook.boards.map(migratePrograms), projects = notebook.agentProjects?.map(migratePrograms)
  if (boards.some((board, index) => board !== notebook.boards[index]) || projects?.some((board, index) => board !== notebook.agentProjects?.[index])) migrated = { ...notebook, boards, ...(projects ? { agentProjects: projects } : {}) }
  if (migrated.workspaceVersion === 1) return migrated
  const upgradedBoards = migrated.boards.some((board) => board.id === 'work-launch')
    ? migrated.boards
    : [projectBoard(), ...migrated.boards]
  const activeBoardId =
    upgradedBoards.find((board) => board.id === 'work-launch' && !board.trashed)?.id ??
    upgradedBoards.find((board) => !board.trashed)!.id
  return { ...migrated, workspaceVersion: 1, boards: upgradedBoards, activeBoardId }
}

export function arrangeNotes(notes: CanvasNote[]): CanvasNote[] {
  if (!notes.length) return []
  const columns = Math.min(3, notes.length)
  const widths = Array.from({ length: columns }, (_, column) =>
    Math.max(
      ...notes.filter((_, i) => i % columns === column).map((n) => n.width),
    ),
  )
  const positions = widths.map((_, column) =>
    widths.slice(0, column).reduce((sum, width) => sum + width + 32, 0),
  )
  const heights = Array(columns).fill(0) as number[]
  return notes.map((note, i) => {
    const column = i % columns
    const result = { ...note, x: positions[column], y: heights[column] }
    heights[column] += note.height + 32
    return result
  })
}

export function noteSearchText(note: CanvasNote): string {
  return [
    note.title,
    note.body,
    note.filename,
    note.url,
    note.latex,
    note.mermaid,
    note.caption,
    note.analysisSource,
    note.concept?.acceptance,
    note.concept?.progress,
    note.concept?.evidence,
    ...(note.cells?.map(cell => `${cell.language} ${cell.code} ${cell.stdin} ${cell.output || ''}`) ?? []),
    note.source?.agent,
    ...(note.programDrivers?.map((driver) => `${driver.name || ''} ${driver.type} ${driver.host || ''} ${driver.port || ''}`) ?? []),
    ...(note.animation?.frames.flatMap((frame) => Object.entries(frame.values).map(([key, value]) => `${key} ${value}`)) ?? []),
    note.programApp?.framework,
    ...(note.entries?.map((entry) => entry.path) ?? []),
    ...(note.items?.map((i) => `${i.text} ${i.owner || ''}`) ?? []),
    ...(note.chart?.labels ?? []),
    ...(note.chart?.series.map((s) => `${s.name} ${s.values.join(' ')}`) ?? []),
    ...(note.rows?.flat() ?? []),
  ]
    .filter(Boolean)
    .join(' ')
}
