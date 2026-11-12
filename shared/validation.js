import { validChart } from './rich-content.js'
import { validEntryPath } from './attachments.js'
import { validConcept, conceptDependencyError } from './concepts.js'
import { validAgentBrief } from './agent-brief.js'

const noteKinds = new Set([
  'text',
  'sticky',
  'image',
  'checklist',
  'table',
  'file',
  'folder',
  'link',
  'markdown',
  'latex',
  'diagram',
  'chart',
  'code', 'analysis', 'concept',
])
const hexColor = /^#[\da-f]{6}$/i
const optionalString = (value, max = 100000) =>
  value === undefined || (typeof value === 'string' && value.length <= max)
const validProvenance = (value) =>
  !!value &&
  typeof value === 'object' &&
  ['agent', 'conversationId', 'url'].every((key) =>
    optionalString(value[key], key === 'url' ? 4000 : 128),
  ) &&
  (value.url === undefined || /^(https?:|codex:)/.test(value.url))
const validSource = (value) =>
  validProvenance(value) &&
  typeof value.requestId === 'string' &&
  value.requestId.length <= 128 &&
  typeof value.section === 'string' &&
  value.section.length <= 200 &&
  typeof value.createdAt === 'string' &&
  Number.isFinite(Date.parse(value.createdAt)) &&
  (value.fingerprint === undefined ||
    (typeof value.fingerprint === 'string' &&
      /^[a-f0-9]{64}$/.test(value.fingerprint)))
const validCaptureContent = (value) => {
  if (!value || typeof value !== 'object') return false
  const fields = ['summaryCharacters', 'markdownCharacters', 'sectionCharacters', 'transcriptCharacters', 'sections', 'decisions', 'actions', 'openQuestions', 'references', 'equations', 'diagrams', 'charts']
  return (
    optionalString(value.markdown, 200000) &&
    (value.markdown === undefined ||
      (Array.isArray(value.markdownNoteIds) &&
        value.markdownNoteIds.length <= 64 &&
        value.markdownNoteIds.every((id) => typeof id === 'string' && id.length <= 128))) &&
    value.received && typeof value.received === 'object' &&
    fields.every((field) => Number.isSafeInteger(value.received[field]) && value.received[field] >= 0) &&
    Array.isArray(value.manifest) && value.manifest.length <= 5000 &&
    value.manifest.every((entry) => entry && typeof entry.id === 'string' && entry.id.length <= 128 &&
      typeof entry.contentHash === 'string' && /^[a-f0-9]{64}$/.test(entry.contentHash))
  )
}

export function validNotebook(value) {
  if (!value || typeof value !== 'object') return false
  if (
    value.version !== 1 ||
    !Array.isArray(value.boards) ||
    !value.boards.length ||
    typeof value.activeBoardId !== 'string'
  )
    return false
  if (
    value.appearance !== undefined &&
    (!value.appearance ||
      typeof value.appearance.accent !== 'string' ||
      typeof value.appearance.canvas !== 'string' ||
      !hexColor.test(value.appearance.accent) ||
      !hexColor.test(value.appearance.canvas))
  )
    return false
  const boardIds = new Set(value.boards.map((board) => board?.id))
  if (
    boardIds.size !== value.boards.length ||
    !boardIds.has(value.activeBoardId) ||
    !value.boards.some((board) => board && !board.trashed)
  )
    return false
  if(value.agentProjects!==undefined&&(!Array.isArray(value.agentProjects)||value.agentProjects.length>1000))return false
  if(value.appMode!==undefined&&!['notes','agents'].includes(value.appMode))return false
  if(!optionalString(value.activeAgentProjectId,128))return false
  const allProjects=[...value.boards,...value.agentProjects||[]]
  if(new Set(allProjects.map(board=>board?.id)).size!==allProjects.length)return false
  return allProjects.every((board) => {
    if(board?.agentBrief!==undefined&&!validAgentBrief(board.agentBrief))return false
    if(board?.executionReceipts!==undefined&&(!Array.isArray(board.executionReceipts)||board.executionReceipts.length>1000||!board.executionReceipts.every(r=>r&&typeof r.requestId==='string'&&r.requestId.length>0&&r.requestId.length<=128&&['code','debug','media'].includes(r.kind)&&typeof r.fingerprint==='string'&&/^[a-f0-9]{64}$/.test(r.fingerprint)&&Number.isFinite(r.at))))return false
    if (
      !board ||
      typeof board.id !== 'string' ||
      typeof board.title !== 'string' ||
      typeof board.description !== 'string' ||
      !Array.isArray(board.notes) ||
      !Array.isArray(board.connections)
    )
      return false
    if (
      board.captures !== undefined &&
      (!Array.isArray(board.captures) ||
        !board.captures.every(
          (capture) =>
            capture &&
            typeof capture.requestId === 'string' &&
            capture.requestId.length <= 128 &&
            typeof capture.fingerprint === 'string' &&
            /^[a-f0-9]{64}$/.test(capture.fingerprint) &&
            typeof capture.title === 'string' &&
            typeof capture.summary === 'string' &&
            typeof capture.createdAt === 'string' &&
            Number.isFinite(Date.parse(capture.createdAt)) &&
            (capture.source === undefined || validProvenance(capture.source)) &&
            (capture.content === undefined || validCaptureContent(capture.content)) &&
            Array.isArray(capture.noteIds) &&
            capture.noteIds.every((id) => typeof id === 'string'),
        ))
    )
      return false
    const noteIds = new Set(board.notes.map((note) => note?.id))
    if (board.notes.some(note => !note || typeof note !== 'object')) return false
    if (board.agents !== undefined && (!Array.isArray(board.agents) || board.agents.length > 100 || !board.agents.every(a => a && typeof a.id === 'string' && a.id.length <= 128 && typeof a.name === 'string' && a.name.length <= 128 && Number.isFinite(a.lastSeenAt) && optionalString(a.currentNoteId,128) && optionalString(a.summary,12000)))) return false
    return (
      noteIds.size === board.notes.length &&
      board.notes.every((note) => {
        if (!note || typeof note.id !== 'string' || !noteKinds.has(note.kind))
          return false
        if (note.kind === 'concept' && !validConcept(note.concept)) return false
        if (note.concept !== undefined && !validConcept(note.concept)) return false
        if (note.kind === 'code' && (!Array.isArray(note.cells) || note.cells.length < 1)) return false
        if (note.cells !== undefined && (
          !Array.isArray(note.cells) || note.cells.length > 40 ||
          new Set(note.cells.map(cell => cell?.id)).size !== note.cells.length ||
          !note.cells.every(cell => cell &&
            typeof cell.id === 'string' && cell.id.length > 0 && cell.id.length <= 128 &&
            typeof cell.language === 'string' && cell.language.length <= 30 &&
            typeof cell.code === 'string' && cell.code.length <= 100000 &&
            typeof cell.stdin === 'string' && cell.stdin.length <= 64000 &&
            ['expected', 'output', 'error', 'executedCode'].every(key => optionalString(cell[key], 262144)) &&
            optionalString(cell.executedInput, 64000) && optionalString(cell.executedLanguage, 30) &&
            ['exitCode', 'executedAt', 'executionCount'].every(key => cell[key] === undefined || Number.isFinite(cell[key])))
        )) return false
        if (!optionalString(note.analysisSource,2000000) || note.analysisFormat!==undefined&&!['csv','tsv','json'].includes(note.analysisFormat)) return false
        if (note.analysisSettings !== undefined) {
          const settings = note.analysisSettings
          const index = value => Number.isInteger(value) && value >= -1 && value < 200
          if (!settings || typeof settings !== 'object' ||
            ['group', 'value'].some(key => settings[key] !== undefined && !index(settings[key])) ||
            settings.chartType !== undefined && !['bar', 'line', 'pie'].includes(settings.chartType) ||
            settings.method !== undefined && !['sum', 'mean', 'count'].includes(settings.method) ||
            settings.order !== undefined && !['source','value','label'].includes(settings.order) ||
            settings.sort !== undefined && (!settings.sort || !index(settings.sort.column) || typeof settings.sort.ascending !== 'boolean') ||
            settings.filter !== undefined && (!settings.filter || !index(settings.filter.column) || !['contains', 'equals', 'greater', 'less'].includes(settings.filter.operator) || !optionalString(settings.filter.value, 20000))) return false
        }
        if (note.kind === 'folder' && !Array.isArray(note.entries)) return false
        if(note.mediaSettings!==undefined){const s=note.mediaSettings;if(!s||!Number.isFinite(s.speed)||s.speed<.25||s.speed>3||!Number.isFinite(s.volume)||s.volume<0||s.volume>1||typeof s.loop!=='boolean'||!Number.isFinite(s.start)||s.start<0||s.start>100000000||!Array.isArray(s.marks)||s.marks.length>200||!s.marks.every(m=>m&&Number.isFinite(m.time)&&m.time>=0&&m.time<=100000000&&typeof m.label==='string'&&m.label.length<=200))return false}
        if(note.modelSettings!==undefined&&(!note.modelSettings||!['wireframe','grid','autoRotate'].every(k=>typeof note.modelSettings[k]==='boolean')))return false
        if(note.analysisOrigin!==undefined){const o=note.analysisOrigin;if(!o||typeof o.noteId!=='string'||o.noteId.length>128||typeof o.contentHash!=='string'||!/^[a-f0-9]{64}$/.test(o.contentHash)||!o.settings||typeof o.settings!=='object'||!['rows','totalGroups'].every(k=>Number.isSafeInteger(o[k])&&o[k]>=0))return false}
        if (
          note.entries !== undefined &&
          (!Array.isArray(note.entries) || note.entries.length > 10000 ||
            new Set(note.entries.map((entry) => entry?.path)).size !== note.entries.length ||
            !note.entries.every((entry) => entry && validEntryPath(entry.path) &&
              ['file', 'directory'].includes(entry.kind) && (entry.assetId === undefined || typeof entry.assetId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(entry.assetId)) &&
              optionalString(entry.mime, 200) && optionalString(entry.error, 1000) &&
              (entry.size === undefined || Number.isSafeInteger(entry.size) && entry.size >= 0) &&
              (entry.modifiedAt === undefined || Number.isFinite(entry.modifiedAt)) &&
              (entry.kind !== 'file' || !!entry.assetId || !!entry.error))))
          return false
        if (note.entries) {
          const entries = new Map(note.entries.map((entry) => [entry.path, entry.kind]))
          if (note.entries.some((entry) => {
            const parts = entry.path.split('/')
            return parts.slice(0, -1).some((_, index) => entries.get(parts.slice(0, index + 1).join('/')) !== 'directory')
          })) return false
        }
        if (
          ![note.x, note.y, note.width, note.height].every(Number.isFinite) ||
          note.width <= 0 ||
          note.height <= 0
        )
          return false
        if (
          ![
            note.title,
            note.body,
            note.color,
            note.label,
            note.src,
            note.assetId,
            note.filename,
            note.mime,
            note.url,
            note.latex,
            note.mermaid,
            note.caption,
            note.modelPath,
          ].every((field) => field === undefined || typeof field === 'string')
        )
          return false
        if (
          !optionalString(note.latex, 12000) ||
          !optionalString(note.mermaid, 20000) ||
          !optionalString(note.caption, 4000) ||
          (note.chart !== undefined && !validChart(note.chart)) ||
          (note.source !== undefined && !validSource(note.source))
        )
          return false
        if (
          (note.kind === 'latex' && !note.latex?.trim()) ||
          (note.kind === 'diagram' && !note.mermaid?.trim()) ||
          (note.kind === 'chart' && !validChart(note.chart))
        )
          return false
        if (
          note.columns !== undefined &&
          (!Array.isArray(note.columns) ||
            !note.columns.every((column) => typeof column === 'string'))
        )
          return false
        if (
          note.rows !== undefined &&
          (!Array.isArray(note.rows) ||
            !note.rows.every(
              (row) =>
                Array.isArray(row) &&
                row.every((cell) => typeof cell === 'string'),
            ))
        )
          return false
        return (
          note.items === undefined ||
          (Array.isArray(note.items) &&
            note.items.every(
              (item) =>
                item &&
                typeof item.id === 'string' &&
                typeof item.text === 'string' &&
                typeof item.done === 'boolean' &&
                optionalString(item.owner, 120) &&
                (item.priority === undefined ||
                  ['high', 'medium', 'low'].includes(item.priority)) &&
                (item.dueDate === undefined ||
                  (typeof item.dueDate === 'string' &&
                    /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate))),
            ))
        )
      }) &&
      !conceptDependencyError(board.notes) &&
      board.connections.every(
        (edge) =>
          edge &&
          typeof edge.id === 'string' &&
          noteIds.has(edge.from) &&
          noteIds.has(edge.to) &&
          optionalString(edge.label, 300) &&
          (edge.style === undefined || ['curve', 'straight', 'elbow'].includes(edge.style)) &&
          (edge.arrow === undefined || ['end', 'both', 'none'].includes(edge.arrow)) &&
          (edge.dashed === undefined || typeof edge.dashed === 'boolean') &&
          (edge.color === undefined || hexColor.test(edge.color)) &&
          [edge.fromSide, edge.toSide].every((side) => side === undefined || ['top', 'right', 'bottom', 'left'].includes(side)),
      )
    )
  })
}
