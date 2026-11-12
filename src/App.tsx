import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { onDesktopClose, setPresentationFullscreen } from './desktop'
import { Presentation } from './Presentation'
import { CanvasPortal } from './CanvasPortal'
import { createPresentationSession } from './presentation-state'
import type { PresentationSession } from './presentation-state'
import { boardSubtree, boardTrail, copyBoardTree, orderedBoards } from '../shared/canvas-tree.js'
import type {
  CSSProperties,
  FormEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react'
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Briefcase,
  CalendarDays,
  Focus,
  LayoutTemplate,
  PanelLeftClose,
  PanelLeftOpen,
  Palette,
  AlignStartVertical,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  HardDrive as CloudCheck,
  Copy,
  Download,
  Ellipsis,
  Expand,
  File,
  FileText,
  FolderOpen,
  Hand,
  ImagePlus,
  LayoutGrid,
  Leaf,
  Link2,
  ListChecks,
  LoaderCircle,
  Maximize2,
  Menu,
  Minus,
  MousePointer2,
  MoveUpRight,
  Pencil,
  Plus,
  Redo2,
  Search,
  Sparkles,
  Sprout,
  Star,
  StickyNote,
  Sun,
  Table2,
  Trash2,
  Type,
  Bot,
  Sigma,
  GitBranch,
  ChartColumn,
  Code2,
  Undo2,
  Upload,
  X,
} from 'lucide-react'
import {
  arrangeNotes,
  makeBoard,
  makeNote,
  noteSearchText,
  uid,
  workDate,
} from './model'
import { boardTasks, ResourceView, TaskFields, TaskView } from './WorkViews'
import { AppearanceSettings, CardColorMenu } from './AppearanceSettings'
import { cardVariables, defaultAppearance, themeVariables } from './appearance'
import { RichCard, RichEditor, SourceBadge, isRichNote } from './RichContent'
import { AgentConnection } from './AgentConnection'
import { ConversationReader } from './ConversationReader'
import { FileLibrary, FolderCard } from './FileLibrary'
import { collectDrop, groupPickedFiles } from './file-import'
import type { ImportGroup } from './file-import'
import { importAssets } from './import-assets'
import type { ImportProgress } from './import-assets'
import { assetIdsForNote, remapNoteAssets } from '../shared/attachments.js'
import { restoreAgentActivity } from '../shared/concepts.js'
import { migrateAgentProjects } from '../shared/agent-workspace.js'
import { mergeWorkspaces } from '../shared/workspace-merge.js'
import { connectionGeometry, connectionSides, nearestSide } from '../shared/connections.js'
import type { ConnectionSide } from '../shared/connections.js'
import { ConnectionPanel } from './ConnectionPanel'
import { WorkbenchCard, WorkbenchEditor, isWorkbenchNote } from './Workbench'
import { AgentStudio } from './AgentStudio'
import type { TaskDraft, WorkspaceView } from './WorkViews'
import type {
  Board,
  BoardTemplate,
  Appearance,
  TaskItem,
  CanvasNote,
  Connection,
  NoteKind,
  Notebook,
  Tool,
  Viewport,
} from './model'
import {
  blobToDataUrl,
  downloadFile,
  getAsset,
  putAsset,
  clearRecoveryNotebook,
  readRecoveryNotebook,
  restoreRecoveryAssets,
  serverConnected,
  WorkspaceConflictError,
  validNotebook,
  writeNotebook,
  refreshNotebook,
} from './storage'

type Modal =
  | 'search'
  | 'new'
  | 'rename'
  | 'export'
  | 'help'
  | 'trash'
  | 'workspace'
  | 'capture'
  | 'appearance'
  | 'agent'
  | null
type Interaction =
  | { type: 'pan'; startX: number; startY: number; view: Viewport }
  | { type: 'connect'; from: string; fromSide: ConnectionSide }
  | {
      type: 'drag' | 'resize'
      startX: number
      startY: number
      note: CanvasNote
    }

const kindNames: Record<NoteKind, string> = {
  board: '子画布',
  text: '文字卡片',
  sticky: '便签',
  image: '图片',
  checklist: '待办清单',
  table: '表格',
  file: '文件',
  folder: '文件夹',
  link: '网页链接',
  markdown: 'Markdown 笔记',
  latex: 'LaTeX 公式',
  diagram: 'Mermaid 图',
  chart: '数据图表',
  code: '多语言代码笔记',
  analysis: '数据分析',
  concept: 'Agent 构想',
}
const kindIcons = {
  board: LayoutGrid,
  markdown: FileText,
  latex: Sigma,
  diagram: GitBranch,
  chart: ChartColumn,
  code: Code2,
  analysis: ChartColumn,
  concept: Bot,
  text: Type,
  sticky: StickyNote,
  image: ImagePlus,
  checklist: ListChecks,
  table: Table2,
  file: FileText,
  folder: FolderOpen,
  link: Link2,
}
const boardIcons = {
  leaf: Leaf,
  sun: Sun,
  book: BookOpen,
  sparkles: Sparkles,
  project: Briefcase,
  meeting: CalendarDays,
  resources: FolderOpen,
}

function IconButton({
  label,
  children,
  onClick,
  active = false,
  disabled = false,
  className = '',
}: {
  label: string
  children: ReactNode
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? 'is-active' : ''} ${className}`}
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? 'small' : ''}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  )
}

function AssetImage({
  note,
  onOpen,
}: {
  note: CanvasNote
  onOpen: () => void
}) {
  const [url, setUrl] = useState(note.src ?? '')
  useEffect(() => {
    let cancelled = false
    let objectUrl = ''
    if (note.assetId)
      getAsset(note.assetId)
        .then((blob) => {
          if (blob && !cancelled) {
            objectUrl = URL.createObjectURL(blob)
            setUrl(objectUrl)
          }
        })
        .catch(() => setUrl(''))
    else setUrl(note.src ?? '')
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [note.assetId, note.src])
  return (
    <div
      className="photo-wrap"
      onDoubleClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
    >
      {url ? (
        <img src={url} draggable={false} alt={note.title || '画布上的照片'} />
      ) : (
        <div className="photo-placeholder">
          <ImagePlus size={30} />
          <span>图片暂时无法读取</span>
        </div>
      )}
      <span className="photo-expand" title="双击查看图片">
        <Expand size={14} />
      </span>
    </div>
  )
}

function formatSize(size = 0) {
  return size >= 1048576
    ? `${(size / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`
}
function safeUrl(url = '') {
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : ''
  } catch {
    return ''
  }
}

export default function App({
  initialNotebook,
}: {
  initialNotebook: Notebook
}) {
  const [notebook, setNotebook] = useState<Notebook>(initialNotebook)
  const notebookRef = useRef(notebook)
  const appMode=notebook.appMode||'notes'
  const agentProjects=(notebook.agentProjects||[]).filter(p=>!p.trashed)
  const agentProject=agentProjects.find(p=>p.id===notebook.activeAgentProjectId)||agentProjects[0]
  const setAppMode=(mode:'notes'|'agents')=>{apply({...notebookRef.current,appMode:mode},false);setSidebarOpen(false)}
  const activeBoard =
    notebook.boards.find(
      (b) => b.id === notebook.activeBoardId && !b.trashed,
    ) ?? notebook.boards.find((b) => !b.trashed)!
  const [view, setView] = useState<Viewport>({ x: 60, y: 160, zoom: 1 })
  const viewRef = useRef(view)
  viewRef.current = view
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageSize, setStageSize] = useState({ width: 1100, height: 750 })
  const [tool, setTool] = useState<Tool>('select')
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('canvas')
  const [focusMode, setFocusMode] = useState(false)
  const [presentation, setPresentation] = useState<PresentationSession | null>(null)
  const presentationRef = useRef(presentation)
  presentationRef.current = presentation
  const presentationStarting = useRef(false)
  const [snapToGrid, setSnapToGrid] = useState(false)
  const [boardTemplate, setBoardTemplate] = useState<BoardTemplate>('blank')
  const [captureKind, setCaptureKind] = useState<'note' | 'task'>('note')
  const [captureText, setCaptureText] = useState('')
  const [capturePriority, setCapturePriority] =
    useState<TaskItem['priority']>('medium')
  const [captureDue, setCaptureDue] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [richEditing, setRichEditing] = useState<CanvasNote | null>(null)
  const [reading, setReading] = useState<{ board: Board; noteId: string } | null>(null)
  const [connectFrom, setConnectFrom] = useState<string | null>(null)
  const [connectionDraft, setConnectionDraft] = useState<{ from: string; fromSide: ConnectionSide; point: { x: number; y: number } } | null>(null)
  const [spaceDown, setSpaceDown] = useState(false)
  const [interacting, setInteracting] = useState(false)
  const interaction = useRef<Interaction | null>(null)
  const touchPoints = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{
    distance: number
    zoom: number
    anchor: { x: number; y: number }
  } | null>(null)
  const history = useRef<Notebook[]>([])
  const future = useRef<Notebook[]>([])
  const [, setHistoryTick] = useState(0)
  const [modal, setModal] = useState<Modal>(null)
  const [appearanceDraft, setAppearanceDraft] = useState<Appearance | null>(
    null,
  )
  const [recoveryAvailable, setRecoveryAvailable] = useState(
    () => !!readRecoveryNotebook(),
  )
  const [modalTitle, setModalTitle] = useState('')
  const [linkEditing, setLinkEditing] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [menu, setMenu] = useState<'add' | 'board' | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    nodeId?: string
  } | null>(null)
  const [toast, setToast] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [workspaceConflict, setWorkspaceConflict] = useState(false)
  const refreshBusy = useRef(false)
  const [exporting, setExporting] = useState(false)
  const [filter, setFilter] = useState<'all' | 'favorites' | 'recent'>('all')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [mobileLayout, setMobileLayout] = useState(
    () => window.matchMedia('(max-width: 900px)').matches,
  )
  const [dropActive, setDropActive] = useState(false)
  const dragDepth = useRef(0)
  const imageInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const pendingImport = useRef<Promise<void> | null>(null)
  const [importing, setImporting] = useState<ImportProgress | null>(null)
  const [importErrors, setImportErrors] = useState<string[]>([])
  const importInput = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<CanvasNote | null>(null)
  const selected = activeBoard.notes.find((n) => n.id === selectedId)
  const tasks = boardTasks(activeBoard)
  const doneTasks = tasks.filter(({ item }) => item.done).length
  const remainingTasks = tasks.length - doneTasks
  const resourceCount = activeBoard.notes.filter((note) =>
    ['image', 'file', 'folder', 'link'].includes(note.kind),
  ).length
  const appearance =
    modal === 'appearance' && appearanceDraft
      ? appearanceDraft
      : (notebook.appearance ?? defaultAppearance)
  const refreshGuard = useRef(false)
  refreshGuard.current = !!(
    presentation ||
    modal ||
    richEditing ||
    reading ||
    editingId ||
    preview ||
    linkEditing ||
    interacting || importing
  )

  async function startPresentation() {
    if (presentationStarting.current || presentationRef.current) return
    if (pendingImport.current || importing) { notify('请等待文件导入完成后再演讲。'); return }
    presentationStarting.current = true
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    setEditingId(null); setMenu(null); setContextMenu(null); setSpaceDown(false)
    interaction.current = null; setInteracting(false)
    try {
      await setPresentationFullscreen(true)
      setPresentation(createPresentationSession(notebookRef.current, activeBoard.id))
    } catch (error) {
      notify(error instanceof Error ? error.message : '无法进入全屏，请重试。')
      void setPresentationFullscreen(false).catch(() => {})
    } finally { presentationStarting.current = false }
  }

  function openAppearance() {
    setAppearanceDraft({
      ...(notebookRef.current.appearance ?? defaultAppearance),
    })
    setModal('appearance')
    setMenu(null)
    setSidebarOpen(false)
  }

  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)')
    const change = () => setMobileLayout(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])

  useEffect(() => {
    if (!modal && !linkEditing && !preview && !richEditing && !reading) return
    const previousFocus = document.activeElement as HTMLElement | null
    const container = [
      ...document.querySelectorAll<HTMLElement>('[aria-modal="true"]'),
    ].pop()
    if (!container) return
    const selector =
      'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]'
    if (!container.contains(document.activeElement))
      container.querySelector<HTMLElement>(selector)?.focus()
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const elements = [
        ...container.querySelectorAll<HTMLElement>(selector),
      ].filter((el) => el.getClientRects().length > 0)
      const first = elements[0],
        last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', trapFocus)
    return () => {
      document.removeEventListener('keydown', trapFocus)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [modal, linkEditing, preview, richEditing, reading])

  function notify(message: string) {
    setToast(message)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 3200)
  }

  async function saveNow() {
    setSaving(true)
    try {
      const submitted=notebookRef.current
      adoptSavedMerge(submitted,await writeNotebook(submitted))
      setSaving(false)
      setSaveError(false)
      setWorkspaceConflict(false)
      notify('工作内容已保存到本机。')
    } catch (error) {
      setSaving(false)
      setSaveError(true)
      setWorkspaceConflict(error instanceof WorkspaceConflictError)
      notify(
        error instanceof WorkspaceConflictError
          ? error.message
          : '保存未成功，请重试或导出备份。',
      )
    }
  }

  function apply(next: Notebook, remember = true) {
    if (remember) {
      history.current = [
        ...history.current.slice(-49),
        structuredClone(notebookRef.current),
      ]
      future.current = []
      setHistoryTick((n) => n + 1)
    }
    notebookRef.current = next
    setNotebook(next)
  }

  function adoptSavedMerge(submitted:Notebook,saved:Notebook) {
    if(JSON.stringify(submitted)===JSON.stringify(saved))return
    const next=mergeWorkspaces(submitted,notebookRef.current,saved)
    apply(next,false)
  }

  function updateBoard(edit: (board: Board) => Board, remember = true) {
    const current = notebookRef.current
    apply(
      {
        ...current,
        boards: current.boards.map((b) =>
          b.id === current.activeBoardId
            ? { ...edit(b), updatedAt: Date.now() }
            : b,
        ),
      },
      remember,
    )
  }

  function updateNote(id: string, patch: Partial<CanvasNote>, remember = true) {
    updateBoard(
      (b) => ({
        ...b,
        notes: b.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
      }),
      remember,
    )
  }

  function updateAgentProject(edit:(project:Board)=>Board){
    const current=notebookRef.current,projectId=current.activeAgentProjectId||current.agentProjects?.find(p=>!p.trashed)?.id
    apply({...current,agentProjects:(current.agentProjects||[]).map(p=>p.id===projectId?{...edit(p),updatedAt:Date.now()}:p)})
  }
  function createAgentProject(){
    const project={...makeBoard(`Agent 项目 ${(notebookRef.current.agentProjects?.length||0)+1}`),id:'agent-'+uid(),notes:[],connections:[],agents:[]}
    apply({...notebookRef.current,appMode:'agents',activeAgentProjectId:project.id,agentProjects:[...notebookRef.current.agentProjects||[],project]})
  }
  function createAgentTask(){const note=makeNote('concept',0,0);updateAgentProject(p=>({...p,notes:[...p.notes,note]}));setRichEditing(note)}
  function saveEditorNote(id:string,patch:Partial<CanvasNote>){if(appMode==='agents')updateAgentProject(p=>({...p,notes:p.notes.map(n=>n.id===id?{...n,...patch}:n)}));else updateNote(id,patch)}
  function openAgentNote(note:CanvasNote){if(['file','folder','image'].includes(note.kind))setPreview(note);else setRichEditing(note)}
  function addEditorChart(fields:Partial<CanvasNote>){
    if(appMode==='agents'){updateAgentProject(project=>({...project,notes:[...project.notes,{...makeNote('chart',0,0),...fields}]}));notify('图表已保存到当前 Agent 项目。')}
    else{addNote('chart',undefined,fields);setRichEditing(richEditing)}
  }

  function undo() {
    const previous = history.current.pop()
    if (!previous) return
    future.current.push(structuredClone(notebookRef.current))
    apply(previous, false)
    setSelectedId(null)
    setEditingId(null)
    setHistoryTick((n) => n + 1)
  }

  function redo() {
    const next = future.current.pop()
    if (!next) return
    history.current.push(structuredClone(notebookRef.current))
    apply(next, false)
    setSelectedId(null)
    setHistoryTick((n) => n + 1)
  }

  function fitNotes(
    notes = notebookRef.current.boards.find(
      (b) => b.id === notebookRef.current.activeBoardId,
    )?.notes ?? [],
  ) {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return
    if (!notes.length) {
      setView({ x: rect.width / 2 - 150, y: rect.height / 2 - 100, zoom: 1 })
      return
    }
    const minX = Math.min(...notes.map((n) => n.x)),
      minY = Math.min(...notes.map((n) => n.y))
    const maxX = Math.max(...notes.map((n) => n.x + n.width)),
      maxY = Math.max(...notes.map((n) => n.y + n.height))
    const zoom = Math.min(
      1,
      (rect.width - 130) / (maxX - minX),
      (rect.height - 80) / (maxY - minY),
    )
    setView({
      x: (rect.width - (maxX - minX) * zoom) / 2 - minX * zoom + 13,
      y: 32 - minY * zoom,
      zoom: Math.max(0.15, zoom),
    })
  }

  useEffect(() => {
    const element = stageRef.current
    if (!element) return
    let previousWidth = 0
    const observer = new ResizeObserver((entries) => {
      if (presentationRef.current) return
      const { width, height } = entries[0].contentRect
      setStageSize({ width, height })
      if (width < 580 && Math.abs(width - previousWidth) > 20) {
        const notes =
          notebookRef.current.boards.find(
            (b) => b.id === notebookRef.current.activeBoardId,
          )?.notes ?? []
        setView({
          x: 35 - Math.min(0, ...notes.map((n) => n.x)) * 0.95,
          y: 28 - Math.min(0, ...notes.map((n) => n.y)) * 0.95,
          zoom: 0.95,
        })
      } else if (width >= 580 && width < 1000) {
        const notes =
          notebookRef.current.boards.find(
            (board) => board.id === notebookRef.current.activeBoardId,
          )?.notes ?? []
        setView({
          x: 83 - Math.min(0, ...notes.map((note) => note.x)) * 0.9,
          y: 30 - Math.min(0, ...notes.map((note) => note.y)) * 0.9,
          zoom: 0.9,
        })
      } else if (width >= 1000) fitNotes()
      previousWidth = width
    })
    observer.observe(element)
    return () => observer.disconnect()
    // A new board gets its own fitted starting view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBoard.id, appMode])

  useEffect(() => {
    document.title = `${appMode==='agents'?(agentProject?.title||'Agent Next to do'):activeBoard.title} · Own`
  }, [activeBoard.title, agentProject?.title, appMode])

  useEffect(() => {
    setSaving(true)
    let active = true
    const timeout = setTimeout(() => {
      writeNotebook(notebook)
        .then((saved) => {
          adoptSavedMerge(notebook,saved)
          if (active) {
            setSaving(false)
            setSaveError(false)
            setWorkspaceConflict(false)
          }
        })
        .catch((error: unknown) => {
          if (!active) return
          setSaving(false)
          setSaveError(true)
          setWorkspaceConflict(error instanceof WorkspaceConflictError)
          notify(
            error instanceof WorkspaceConflictError
              ? error.message
              : '本地服务保存未完成，请重试保存或导出备份。',
          )
        })
    }, 450)
    const flush = () => {
      void writeNotebook(notebookRef.current, true).catch(() => {})
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      active = false
      clearTimeout(timeout)
      window.removeEventListener('beforeunload', flush)
    }
  }, [notebook])

  useEffect(() => onDesktopClose(async (discardDraft) => {
    const hasDraft = richEditing || linkEditing ||
      modal === 'capture' || modal === 'new' || modal === 'rename' || modal === 'appearance'
    if (hasDraft && !discardDraft) return 'draft'
    if (pendingImport.current) await pendingImport.current
    // Commit contenteditable fields before flushing the current notebook to disk.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    await writeNotebook(notebookRef.current)
    return 'saved'
  }), [richEditing, linkEditing, modal])

  async function receiveWorkspace(force = false, announce = true) {
    if (
      refreshBusy.current ||
      pendingImport.current ||
      (!force &&
        (presentationRef.current || modal ||
          richEditing ||
          reading ||
          editingId ||
          preview ||
          linkEditing ||
          interacting ||
          interaction.current))
    )
      return
    if (
      !force &&
      document.activeElement?.closest(
        'input,textarea,select,[contenteditable="true"]',
      )
    )
      return
    const current = notebookRef.current
    refreshBusy.current = true
    try {
      const next = await refreshNotebook(
        current,
        () =>
          notebookRef.current === current &&
          (force ||
            (!refreshGuard.current &&
              !interaction.current &&
              !document.activeElement?.closest(
                'input,textarea,select,[contenteditable="true"]',
              ))),
        force,
      )
      if (!next) return
      history.current = []
      future.current = []
      notebookRef.current = next
      setNotebook(next)
      setHistoryTick((n) => n + 1)
      setSaveError(false)
      setWorkspaceConflict(false)
      setRecoveryAvailable(!!readRecoveryNotebook())
      if (
        selectedId &&
        !next.boards
          .find((board) => board.id === next.activeBoardId)
          ?.notes.some((note) => note.id === selectedId)
      )
        setSelectedId(null)
      if (force) notify('已接收最新内容；未保存的本地修改可在工作空间中恢复。')
      else if (announce) notify('已接收工作空间更新。')
    } catch {
      if (force) notify('更新暂时无法读取，请确认本地服务正在运行。')
    } finally {
      refreshBusy.current = false
    }
  }

  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) void receiveWorkspace()
    }
    const timer = setInterval(refresh, 3000)
    const events = new EventSource('/api/events')
    events.addEventListener('workspace', () => {
      if (!document.hidden) void receiveWorkspace(false, false)
    })
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(timer)
      events.close()
      window.removeEventListener('focus', refresh)
    }
    // Refresh only when no editor or canvas gesture is active.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    modal,
    richEditing,
    reading,
    editingId,
    preview,
    linkEditing,
    interacting,
    selectedId,
  ])

  const deepLinkHandled = useRef(false)
  useEffect(() => {
    if (deepLinkHandled.current || !stageSize.width) return
    const params = new URLSearchParams(window.location.search)
    if(params.get('mode')==='agents'){
      const project=notebookRef.current.agentProjects?.find(p=>p.id===params.get('project')&&!p.trashed)
      apply({...notebookRef.current,appMode:'agents',...(project?{activeAgentProjectId:project.id}:{})},false)
      deepLinkHandled.current=true
      const note=project?.notes.find(n=>n.id===params.get('note'));if(note)openAgentNote(note)
      return
    }
    const board = notebookRef.current.boards.find(
      (board) => board.id === params.get('board') && !board.trashed,
    )
    if (!board) return
    deepLinkHandled.current = true
    focusResult(
      board,
      board.notes.find((note) => note.id === params.get('note')),
    )
    const capture = board.captures?.find((capture) => capture.requestId === params.get('conversation'))
    if (capture) {
      const first = capture.noteIds.find((id) => board.notes.some((note) => note.id === id))
      if (first) setReading({ board, noteId: first })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageSize.width])

  function canvasPoint(clientX: number, clientY: number) {
    const rect = stageRef.current!.getBoundingClientRect()
    const current = viewRef.current
    return {
      x: (clientX - rect.left - current.x) / current.zoom,
      y: (clientY - rect.top - current.y) / current.zoom,
    }
  }

  function addNote(
    kind: NoteKind,
    point?: { x: number; y: number },
    overrides?: Partial<CanvasNote>,
  ) {
    const current = viewRef.current
    const center = point ?? {
      x: (stageSize.width / 2 - current.x) / current.zoom - 155,
      y: (stageSize.height / 2 - current.y) / current.zoom - 85,
    }
    const child = kind === 'board' ? { ...makeBoard('子画布', 'blank'), parentBoardId: activeBoard.id } : undefined
    const note = { ...makeNote(kind, center.x, center.y), ...overrides, ...(child ? { childBoardId: child.id } : {}) }
    if (child) {
      const current = notebookRef.current
      apply({ ...current, boards: [...current.boards.map(board => board.id === activeBoard.id ? { ...board, notes: [...board.notes, note], updatedAt: Date.now() } : board), child] })
    } else updateBoard((b) => ({ ...b, notes: [...b.notes, note] }))
    setWorkspaceView('canvas')
    setSelectedId(note.id)
    setSelectedEdge(null)
    setTool('select')
    setMenu(null)
    setContextMenu(null)
    if (isRichNote(note) || isWorkbenchNote(note)) setRichEditing(note)
    return note
  }

  function selectBoard(id: string) {
    if (!notebookRef.current.boards.some(board => board.id === id && !board.trashed)) { notify('子画布已在回收站，可恢复后查看。'); return }
    if (id !== activeBoard.id || notebookRef.current.appMode==='agents') {
      apply(
        {
          ...notebookRef.current,
          activeBoardId: id,
          appMode:'notes',
          boards: notebookRef.current.boards.map((b) =>
            b.id === id ? { ...b, lastOpenedAt: Date.now() } : b,
          ),
        },
        false,
      )
      setSelectedId(null)
      setEditingId(null)
      setSelectedEdge(null)
      setTool('select')
      setConnectFrom(null)
    }
    setSidebarOpen(false)
    setMenu(null)
    setWorkspaceView('canvas')
  }

  function removeNote(id = selectedId) {
    if (!id) return
    updateBoard((b) => ({
      ...b,
      notes: b.notes.filter((n) => n.id !== id),
      connections: b.connections.filter((c) => c.from !== id && c.to !== id),
    }))
    setSelectedId(null)
    setEditingId(null)
    setContextMenu(null)
  }

  function duplicateNote(id = selectedId) {
    const original = activeBoard.notes.find((n) => n.id === id)
    if (!original) return
    const copy = {
      ...structuredClone(original),
      id: uid(),
      x: original.x + 28,
      y: original.y + 28,
    }
    if(copy.concept){
      copy.concept={...copy.concept,lease:undefined,agentId:undefined,...(copy.concept.status==='running'?{status:'pending'}:{})}
    }
    updateBoard((b) => ({ ...b, notes: [...b.notes, copy] }))
    setSelectedId(copy.id)
    setContextMenu(null)
  }

  function changeZoom(zoom: number, clientX?: number, clientY?: number) {
    const current = viewRef.current
    const rect = stageRef.current?.getBoundingClientRect()
    const nextZoom = Math.max(0.15, Math.min(3, zoom))
    const x =
      clientX !== undefined && rect ? clientX - rect.left : stageSize.width / 2
    const y =
      clientY !== undefined && rect ? clientY - rect.top : stageSize.height / 2
    setView({
      x: x - ((x - current.x) / current.zoom) * nextZoom,
      y: y - ((y - current.y) / current.zoom) * nextZoom,
      zoom: nextZoom,
    })
  }

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const wheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest('[data-canvas-ui]')) return
      event.preventDefault()
      if (event.ctrlKey || event.metaKey)
        changeZoom(
          viewRef.current.zoom * Math.exp(-event.deltaY * 0.008),
          event.clientX,
          event.clientY,
        )
      else
        setView((v) => ({
          ...v,
          x: v.x - (event.shiftKey ? event.deltaY : event.deltaX),
          y: v.y - (event.shiftKey ? 0 : event.deltaY),
        }))
    }
    stage.addEventListener('wheel', wheel, { passive: false })
    return () => stage.removeEventListener('wheel', wheel)
  }, [stageSize])

  function connectCards(from: string, to: string, fromSide?: ConnectionSide, toSide?: ConnectionSide) {
    if (from === to) return
    const duplicate = activeBoard.connections.find((edge) => edge.from === from && edge.to === to && edge.fromSide === fromSide && edge.toSide === toSide)
    if (duplicate) { setSelectedEdge(duplicate.id); setSelectedId(null); notify('这两张卡片已连接，可编辑关系。'); return }
    const edge: Connection = { id: uid(), from, to, fromSide, toSide, style: 'curve', arrow: 'end' }
    updateBoard((board) => ({ ...board, connections: [...board.connections, edge] }))
    setSelectedEdge(edge.id); setSelectedId(null); setConnectFrom(null); setTool('select')
  }

  function clickConnect(note: CanvasNote) {
    if (!connectFrom) { setConnectFrom(note.id); notify('点击另一张卡片完成连线，也可以拖动连接点。') }
    else if (connectFrom !== note.id) connectCards(connectFrom, note.id)
  }

  function beginConnection(event: ReactPointerEvent, note: CanvasNote, side: ConnectionSide) {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation()
    setSelectedId(note.id); setSelectedEdge(null)
    interaction.current = { type: 'connect', from: note.id, fromSide: side }
    setConnectionDraft({ from: note.id, fromSide: side, point: canvasPoint(event.clientX, event.clientY) })
    setInteracting(true)
    stageRef.current?.setPointerCapture(event.pointerId)
  }

  function beginNodeDrag(event: ReactPointerEvent, note: CanvasNote) {
    if (event.button !== 0 || tool === 'hand' || spaceDown) return
    event.stopPropagation()
    if (
      (event.target as HTMLElement).closest(
        'button, a, input, textarea, select, [data-canvas-ui], [contenteditable="true"]',
      )
    )
      return
    setSelectedId(note.id)
    setSelectedEdge(null)
    if (tool === 'connect') {
      clickConnect(note)
      return
    }
    setEditingId(null)
    interaction.current = {
      type: 'drag',
      startX: event.clientX,
      startY: event.clientY,
      note: structuredClone(note),
    }
  }

  function onStagePointerDown(event: ReactPointerEvent) {
    if ((event.target as HTMLElement).closest('[data-canvas-ui]')) return
    setMenu(null)
    setContextMenu(null)
    if (
      event.button === 1 ||
      spaceDown ||
      tool === 'hand' ||
      (event.pointerType === 'touch' &&
        tool === 'select' &&
        !(event.target as HTMLElement).closest('[data-node]'))
    ) {
      event.preventDefault()
      interaction.current = {
        type: 'pan',
        startX: event.clientX,
        startY: event.clientY,
        view: { ...view },
      }
      stageRef.current?.setPointerCapture(event.pointerId)
      setInteracting(true)
      return
    }
    if (event.button !== 0) return
    if (['text', 'sticky', 'table', 'checklist'].includes(tool)) {
      addNote(tool as NoteKind, canvasPoint(event.clientX, event.clientY))
      return
    }
    if (!(event.target as HTMLElement).closest('[data-node]')) {
      setSelectedId(null)
      setSelectedEdge(null)
      setEditingId(null)
      setConnectFrom(null)
    }
  }

  function onPointerMove(event: ReactPointerEvent) {
    if (touchPoints.current.has(event.pointerId))
      touchPoints.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      })
    if (pinch.current && touchPoints.current.size === 2) {
      const [a, b] = [...touchPoints.current.values()]
      const zoom = Math.min(
        3,
        Math.max(
          0.15,
          (pinch.current.zoom * Math.hypot(b.x - a.x, b.y - a.y)) /
            pinch.current.distance,
        ),
      )
      const rect = stageRef.current!.getBoundingClientRect()
      setView({
        x: (a.x + b.x) / 2 - rect.left - pinch.current.anchor.x * zoom,
        y: (a.y + b.y) / 2 - rect.top - pinch.current.anchor.y * zoom,
        zoom,
      })
      return
    }
    const current = interaction.current
    if (!current) return
    if (current.type === 'connect') {
      setConnectionDraft({ from: current.from, fromSide: current.fromSide, point: canvasPoint(event.clientX, event.clientY) })
      return
    }
    const dx = event.clientX - current.startX,
      dy = event.clientY - current.startY
    if (current.type === 'pan') {
      setView({
        ...current.view,
        x: current.view.x + dx,
        y: current.view.y + dy,
      })
      return
    }
    if (Math.abs(dx) + Math.abs(dy) < 3 && !interacting) return
    if (!interacting) {
      stageRef.current?.setPointerCapture(event.pointerId)
      history.current = [
        ...history.current.slice(-49),
        structuredClone(notebookRef.current),
      ]
      future.current = []
      setInteracting(true)
      setHistoryTick((n) => n + 1)
    }
    if (current.type === 'drag')
      updateNote(
        current.note.id,
        {
          x: snapToGrid
            ? Math.round((current.note.x + dx / view.zoom) / 16) * 16
            : current.note.x + dx / view.zoom,
          y: snapToGrid
            ? Math.round((current.note.y + dy / view.zoom) / 16) * 16
            : current.note.y + dy / view.zoom,
        },
        false,
      )
    else
      updateNote(
        current.note.id,
        {
          width: Math.max(220, current.note.width + dx / view.zoom),
          height: Math.max(
            current.note.kind === 'file' || current.note.kind === 'link'
              ? 110
              : 150,
            current.note.height + dy / view.zoom,
          ),
        },
        false,
      )
  }

  function endInteraction(event: ReactPointerEvent) {
    const current = interaction.current
    if (current?.type === 'connect' && event.type !== 'pointercancel') {
      const target = document.elementFromPoint(event.clientX, event.clientY)
      const id = target?.closest('[data-node]')?.getAttribute('data-node')
      const note = activeBoard.notes.find((note) => note.id === id)
      if (note && id !== current.from) {
        const side = target?.closest('[data-connection-handle]')?.getAttribute('data-connection-handle') as ConnectionSide | null
        connectCards(current.from, note.id, current.fromSide, side || nearestSide(note, canvasPoint(event.clientX, event.clientY)))
      }
    }
    setConnectionDraft(null)
    touchPoints.current.delete(event.pointerId)
    if (touchPoints.current.size < 2) pinch.current = null
    interaction.current = null
    setInteracting(false)
    if (stageRef.current?.hasPointerCapture(event.pointerId))
      stageRef.current.releasePointerCapture(event.pointerId)
  }

  function trackTouch(event: ReactPointerEvent) {
    if (
      event.pointerType !== 'touch' ||
      (event.target as HTMLElement).closest('[data-canvas-ui]')
    )
      return
    touchPoints.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    })
    if (touchPoints.current.size !== 2) return
    event.stopPropagation()
    const [a, b] = [...touchPoints.current.values()]
    pinch.current = {
      distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      zoom: viewRef.current.zoom,
      anchor: canvasPoint((a.x + b.x) / 2, (a.y + b.y) / 2),
    }
    interaction.current = null
    setInteracting(true)
    for (const id of touchPoints.current.keys())
      stageRef.current?.setPointerCapture(id)
  }

  function addImport(groups: ImportGroup[] | Promise<ImportGroup[]>, point?: { x: number; y: number }) {
    if (pendingImport.current) { void Promise.resolve(groups).catch(() => {}); notify('正在导入，请完成后再添加下一批文件。'); return }
    // Bind an asynchronous import to its original board, even if the user navigates away.
    const boardId = notebookRef.current.activeBoardId
    const origin = point || { x: (stageSize.width / 2 - viewRef.current.x) / viewRef.current.zoom - 160, y: (stageSize.height / 2 - viewRef.current.y) / viewRef.current.zoom - 120 }
    setImporting({ done: 0, total: 0, name: '正在读取目录…' })
    setImportErrors([])
    const job = (async () => {
      try {
        const result = await importAssets(await groups, origin, putAsset, setImporting)
        const current = notebookRef.current
        if (result.notes.length && current.boards.some((board) => board.id === boardId)) {
          apply({ ...current, boards: current.boards.map((board) => board.id === boardId ? { ...board, notes: [...board.notes, ...result.notes] } : board) })
          if (current.activeBoardId === boardId) setSelectedId(result.notes.at(-1)!.id)
          setTool('select')
        }
        setImportErrors(result.errors)
        notify(result.errors.length ? `导入已结束，${result.errors.length} 个文件需要处理。` : `已将 ${result.notes.length} 项内容保存在笔记中。`)
      } catch (error) {
        setImportErrors([error instanceof Error ? error.message : '导入未完成，请重试。'])
      } finally { setImporting(null) }
    })()
    pendingImport.current = job
    void job.finally(() => { if (pendingImport.current === job) pendingImport.current = null })
  }

  function addFiles(files: FileList | File[], point?: { x: number; y: number }) {
    addImport(groupPickedFiles(files), point)
  }

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (presentationRef.current) return
      const target = event.target as HTMLElement
      if (target.closest('input, textarea, [contenteditable="true"]') || modal || reading || richEditing || preview || linkEditing)
        return
      const files = event.clipboardData?.files
      if (files?.length) {
        event.preventDefault()
        void addFiles(files)
        return
      }
      const text = event.clipboardData?.getData('text/plain')
      if (!text?.trim()) return
      event.preventDefault()
      if (text.includes('\t')) {
        const rows = text
          .trim()
          .split(/\r?\n/)
          .map((row) => row.split('\t'))
        addNote('table', undefined, {
          title: '粘贴的表格',
          columns: rows[0],
          rows: rows.slice(1),
          width: Math.max(380, rows[0].length * 110),
          height: Math.max(200, Math.min(600, rows.length * 44 + 100)),
        })
      } else if (safeUrl(text.trim()))
        addNote('link', undefined, {
          title: new URL(text.trim()).hostname,
          url: text.trim(),
          body: text.trim(),
        })
      else addNote('text', undefined, { title: '快速笔记', body: text })
      notify('已粘贴到画布。')
    }
    document.addEventListener('paste', paste)
    return () => document.removeEventListener('paste', paste)
  }, [modal, reading, richEditing, preview, linkEditing, activeBoard.id, stageSize])

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (presentationRef.current) return
      const isInput = (event.target as HTMLElement).closest(
        'input, textarea, [contenteditable="true"]',
      )
      if (event.key === 'Escape') {
        if (window.mathVirtualKeyboard?.visible) { window.mathVirtualKeyboard.hide(); return }
        interaction.current = null
        setConnectionDraft(null)
        setInteracting(false)
        if (reading) {
          setReading(null)
          return
        }
        if (richEditing) {
          setRichEditing(null)
          return
        }
        setModal(null)
        setLinkEditing(null)
        setMenu(null)
        setContextMenu(null)
        setPreview(null)
        setEditingId(null)
        setConnectFrom(null)
        setTool('select')
        return
      }
      if (reading) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setModal('search')
        return
      }
      if (
        isInput ||
        modal ||
        preview ||
        linkEditing ||
        richEditing ||
        event.isComposing
      )
        return
      if(appMode==='agents'){
        if(event.ctrlKey||event.metaKey){
          if(event.key.toLowerCase()==='s'){event.preventDefault();void saveNow()}
          if(event.key.toLowerCase()==='z'){event.preventDefault();if(event.shiftKey)redo();else undo()}
          if(event.key.toLowerCase()==='y'){event.preventDefault();redo()}
        }else if(event.key.toLowerCase()==='f')setFocusMode(value=>!value)
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        openCapture()
        return
      }
      if (event.key.toLowerCase() === 'f' && !event.ctrlKey && !event.metaKey) {
        setFocusMode((value) => !value)
        return
      }
      if (event.code === 'Space') {
        event.preventDefault()
        setSpaceDown(true)
      }
      if (event.ctrlKey || event.metaKey) {
        if (event.key.toLowerCase() === 'z') {
          event.preventDefault()
          if (event.shiftKey) redo()
          else undo()
        }
        if (event.key.toLowerCase() === 'y') {
          event.preventDefault()
          redo()
        }
        if (event.key.toLowerCase() === 'd') {
          event.preventDefault()
          duplicateNote()
        }
        if (event.key.toLowerCase() === 's') {
          event.preventDefault()
          void saveNow()
        }
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        if (selectedEdge) {
          updateBoard((b) => ({
            ...b,
            connections: b.connections.filter((c) => c.id !== selectedEdge),
          }))
          setSelectedEdge(null)
        } else removeNote()
      }
      if (workspaceView !== 'canvas') return
      const shortcuts: Record<string, Tool> = {
        v: 'select',
        h: 'hand',
        t: 'text',
        n: 'sticky',
        c: 'connect',
        l: 'checklist',
      }
      if (shortcuts[event.key.toLowerCase()])
        setTool(shortcuts[event.key.toLowerCase()])
      if (event.key === '0') fitNotes()
      if (event.key === '+' || event.key === '=') changeZoom(view.zoom * 1.15)
      if (event.key === '-') changeZoom(view.zoom / 1.15)
      if (event.key === '?') setModal('help')
      if (
        selected &&
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
      ) {
        event.preventDefault()
        const step = event.shiftKey ? 10 : 1
        updateNote(selected.id, {
          x:
            selected.x +
            (event.key === 'ArrowRight'
              ? step
              : event.key === 'ArrowLeft'
                ? -step
                : 0),
          y:
            selected.y +
            (event.key === 'ArrowDown'
              ? step
              : event.key === 'ArrowUp'
                ? -step
                : 0),
        })
      }
    }
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceDown(false)
    }
    const blur = () => {
      setSpaceDown(false)
      interaction.current = null
      pinch.current = null
      touchPoints.current.clear()
      setInteracting(false)
    }
    document.addEventListener('keydown', down)
    document.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      document.removeEventListener('keydown', down)
      document.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  })

  function openFile(note: CanvasNote) { setPreview(note) }

  async function exportBackup() {
    setExporting(true)
    try {
      const current = structuredClone(notebookRef.current)
      const assetIds = [
        ...new Set(
          [...current.boards,...current.agentProjects||[]].flatMap((b) =>
            b.notes.flatMap(assetIdsForNote),
          ),
        ),
      ]
      const assets: Record<string, string> = {}
      for (const id of assetIds) {
        const blob = await getAsset(id)
        if (!blob) throw new Error('Missing asset')
        assets[id] = await blobToDataUrl(blob)
      }
      downloadFile(
        new Blob(
          [
            JSON.stringify(
              { app: 'Own', notebook: current, assets },
              null,
              2,
            ),
          ],
          { type: 'application/json' },
        ),
        `Own-备份-${new Date().toISOString().slice(0, 10)}.own`,
      )
      notify('画布和附件，已一起打包。')
      setModal(null)
    } catch {
      notify('备份未完成：有附件无法读取，请保留当前工作空间数据。')
    } finally {
      setExporting(false)
    }
  }

  async function restoreUnsavedNotes() {
    const recovery = readRecoveryNotebook()
    if (!recovery) return
    try {
      await restoreRecoveryAssets(recovery)
      const migrated=migrateAgentProjects(recovery)
      const boards = copyBoardTree(migrated.boards.filter(board => !board.trashed), uid)
        .map(board => ({ ...board, title: `${board.title}（恢复副本）` }))
      if (!boards.length) return
      const projects=(migrated.agentProjects||[]).filter(project=>!project.trashed).map(restoreAgentActivity).map(project=>({...project,id:'agent-'+uid(),legacyBoardId:undefined,title:project.title+'（恢复副本）'}))
      apply({
        ...notebookRef.current,
        boards: [...notebookRef.current.boards, ...boards],
        activeBoardId: boards[0].id,
        agentProjects:[...notebookRef.current.agentProjects||[],...projects],
        appMode:'notes',
      })
      clearRecoveryNotebook()
      setRecoveryAvailable(false)
      setModal(null)
      setWorkspaceView('canvas')
      notify('未保存记录已恢复为画布和 Agent 项目副本。')
    } catch {
      notify('恢复未完成，请确认本地服务正在运行后重试。')
    }
  }

  function exportMarkdown() {
    const exportedBoard=appMode==='agents'&&agentProject?agentProject:activeBoard
    const exportBoards = appMode === 'agents' ? [exportedBoard] : boardSubtree(notebook.boards, exportedBoard.id).filter(board => !board.trashed)
    const text = exportBoards.map(exportedBoard => [
      `# ${exportedBoard.title}`,
      exportedBoard.description,
      ...exportedBoard.notes.map((note) => {
        if (note.kind === 'board') return `## 子画布：${notebook.boards.find(board => board.id === note.childBoardId)?.title || note.title}\n\n内容见后续画布章节。`
        if (note.kind === 'code') return `## ${note.title}\n\n${note.body||''}\n\n${(note.cells||[]).map((cell,i)=>`### 单元 ${i+1}\n\n\`\`\`${cell.language}\n${cell.code}\n\`\`\`\n\n输入：\n\`\`\`text\n${cell.stdin}\n\`\`\`\n\n预期：\n\`\`\`text\n${cell.expected||''}\n\`\`\`\n\n实际输出：\n\`\`\`text\n${cell.output||''}\n${cell.error||''}\n\`\`\``).join('\n\n')}`
        if (note.kind === 'analysis') return `## ${note.title}\n\n\`\`\`${note.analysisFormat||'csv'}\n${note.analysisSource||''}\n\`\`\``
        if (note.kind === 'concept') return `## ${note.title}\n\n状态：${note.concept?.status}\n\n${note.body||''}\n\n### 验收标准\n${note.concept?.acceptance||''}\n\n### 最新进展\n${note.concept?.progress||''}\n\n### 产物与验证\n${note.concept?.evidence||''}`
        if (note.kind === 'latex')
          return `## ${note.title}\n\n$$\n${note.latex}\n$$\n\n${note.caption || ''}`
        if (note.kind === 'diagram')
          return `## ${note.title}\n\n\`\`\`mermaid\n${note.mermaid}\n\`\`\`\n\n${note.caption || ''}`
        if (note.kind === 'chart' && note.chart)
          return `## ${note.title}\n\n${note.caption || ''}\n\n| 项目 | ${note.chart.series.map((s) => s.name).join(' | ')} |\n| --- | ${note.chart.series.map(() => '---').join(' | ')} |\n${note.chart.labels.map((label, i) => `| ${label} | ${note.chart!.series.map((s) => s.values[i]).join(' | ')} |`).join('\n')}\n\n单位：${note.chart.unit || '未指定'}`
        if (note.kind === 'checklist')
          return `## ${note.title}\n\n${note.items?.map((item) => `- [${item.done ? 'x' : ' '}] ${item.text}${item.owner ? ` · 负责人 ${item.owner}` : ''}${item.priority ? ` · ${{ high: '高', medium: '中', low: '低' }[item.priority]}优先级` : ''}${item.dueDate ? ` · 截止 ${item.dueDate}` : ''}`).join('\n')}`
        if (note.kind === 'table')
          return `## ${note.title}\n\n| ${note.columns?.join(' | ')} |\n| ${note.columns?.map(() => '---').join(' | ')} |\n${note.rows?.map((row) => `| ${row.join(' | ')} |`).join('\n')}`
        if (note.kind === 'link') return `[${note.title}](${note.url})`
        if (note.kind === 'folder') return `## ${note.title}\n\n${(note.entries || []).map((entry) => `- ${entry.path}${entry.kind === 'directory' ? '/' : ''}${entry.error ? '（未导入）' : ''}`).join('\n')}\n\n（原始文件请使用完整备份导出）`
        if (note.kind === 'file' || note.kind === 'image')
          return `## ${note.title || note.filename}\n\n（${kindNames[note.kind]}，附件请使用完整备份导出）`
        return `## ${note.title ?? ''}\n\n${note.body ?? ''}`
      }),
    ].join('\n\n')).join('\n\n---\n\n')
    downloadFile(
      new Blob([text], { type: 'text/markdown;charset=utf-8' }),
      `${exportedBoard.title}.md`,
    )
    setModal(null)
    notify('文字已导出为 Markdown。')
  }

  async function importBackup(file?: File) {
    if (!file) return
    try {
      const backup = JSON.parse(await file.text()) as {
        notebook: unknown
        assets?: Record<string, string>
      }
      if (!validNotebook(backup.notebook)) throw new Error('Invalid file')
      const imported = migrateAgentProjects(backup.notebook)
      const assets = backup.assets ?? {}
      if ([...imported.boards,...imported.agentProjects||[]].flatMap((board) => board.notes.flatMap(assetIdsForNote)).some((id) => !(id in assets)))
        throw new Error('备份中缺少原始附件，无法完整恢复。')
      const newIds = new Map<string, string>()
      for (const [id, dataUrl] of Object.entries(assets)) {
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:'))
          throw new Error('Invalid asset')
        const newId = uid()
        await putAsset(newId, await fetch(dataUrl).then((r) => r.blob()))
        newIds.set(id, newId)
      }
      const boards = copyBoardTree(imported.boards.filter(board => !board.trashed).map(restoreAgentActivity), uid)
        .map(board => ({ ...board, notes: board.notes.map(note => remapNoteAssets(note, newIds)) }))
      if (!boards.length) throw new Error('Empty backup')
      const restoredProjects=(imported.agentProjects||[]).filter(p=>!p.trashed).map(restoreAgentActivity).map(project=>({...project,id:'agent-'+uid(),legacyBoardId:undefined,notes:project.notes.map(note=>remapNoteAssets(note,newIds))}))
      apply({
        ...notebookRef.current,
        boards: [...notebookRef.current.boards, ...boards],
        agentProjects:[...notebookRef.current.agentProjects||[],...restoredProjects],
        activeBoardId: boards[0].id,
        appMode: 'notes',
        appearance: imported.appearance ?? notebookRef.current.appearance,
      })
      setSelectedId(null)
      setModal(null)
      notify(`已导入 ${boards.length} 块画布${restoredProjects.length?`和 ${restoredProjects.length} 个 Agent 项目`:''}。`)
    } catch {
      notify('无法完整导入，请确认备份包含所有原始附件，并选择 Own 导出的 .own 文件。')
    }
  }

  function submitBoard(event: FormEvent) {
    event.preventDefault()
    const title = modalTitle.trim()
    if (!title) return
    if (modal === 'new') {
      const board = makeBoard(title, boardTemplate)
      apply({
        ...notebookRef.current,
        boards: [...notebookRef.current.boards, board],
        activeBoardId: board.id,
      })
      setSelectedId(null)
      setFilter('all')
      setWorkspaceView('canvas')
      setSidebarOpen(false)
      notify('画布已创建。')
    } else updateBoard((b) => ({ ...b, title }))
    setModal(null)
  }

  function openCapture(kind: 'note' | 'task' = 'note') {
    setCaptureKind(kind)
    setCaptureText('')
    setCaptureDue('')
    setCapturePriority('medium')
    setModal('capture')
    setMenu(null)
  }

  function addWorkTask(draft: TaskDraft) {
    const item: TaskItem = { id: uid(), done: false, ...draft }
    const checklist = activeBoard.notes.find(
      (note) => note.kind === 'checklist',
    )
    if (checklist)
      updateNote(checklist.id, {
        items: [...(checklist.items ?? []), item],
        height: Math.max(
          checklist.height,
          135 + ((checklist.items?.length ?? 0) + 1) * 37,
        ),
      })
    else {
      const note = {
        ...makeNote('checklist', 0, 0),
        title: '项目任务',
        items: [item],
      }
      updateBoard((board) => ({ ...board, notes: [...board.notes, note] }))
    }
    notify('任务已添加到项目清单。')
  }

  function updateWorkTask(
    noteId: string,
    itemId: string,
    patch: Partial<TaskItem>,
  ) {
    const note = notebookRef.current.boards
      .find((board) => board.id === notebookRef.current.activeBoardId)
      ?.notes.find((note) => note.id === noteId)
    if (note)
      updateNote(noteId, {
        items: note.items?.map((item) =>
          item.id === itemId ? { ...item, ...patch } : item,
        ),
      })
  }

  function locateNote(note: CanvasNote) {
    setWorkspaceView('canvas')
    setSelectedId(note.id)
    setEditingId(null)
    setTool('select')
    centerNote(note)
  }

  function centerNote(note: CanvasNote) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const rect = stageRef.current?.getBoundingClientRect()
        if (!rect) return
        const zoom = Math.min(
          1,
          (rect.width - 50) / note.width,
          (rect.height - 60) / note.height,
        )
        setView({
          x: rect.width / 2 - (note.x + note.width / 2) * zoom,
          y: rect.height / 2 - (note.y + note.height / 2) * zoom,
          zoom: Math.max(0.15, zoom),
        })
      }),
    )
  }

  function tidyBoard() {
    updateBoard((board) => ({ ...board, notes: arrangeNotes(board.notes) }))
    requestAnimationFrame(() => fitNotes())
    notify('已整理为整齐的布局，可随时撤销。')
  }

  function openResource(note: CanvasNote) {
    if (note.kind === 'link') {
      const url = safeUrl(note.url)
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
    } else void openFile(note)
  }

  function submitCapture(event: FormEvent) {
    event.preventDefault()
    const text = captureText.trim()
    if (!text) return
    if (captureKind === 'task')
      addWorkTask({
        text,
        priority: capturePriority,
        dueDate: captureDue || undefined,
      })
    else {
      const [title, ...body] = text.split('\n')
      const rightEdge = Math.max(
        0,
        ...activeBoard.notes.map((note) => note.x + note.width),
      )
      const note = {
        ...makeNote('text', rightEdge ? rightEdge + 32 : 0, 0),
        title: title.slice(0, 100),
        body: body.join('\n'),
        height: Math.max(190, Math.min(440, 120 + body.length * 24)),
      }
      updateBoard((board) => ({ ...board, notes: [...board.notes, note] }))
      locateNote(note)
      notify('笔记已添加到画布。')
    }
    setModal(null)
  }

  function trashBoard() {
    const current = notebookRef.current
    const removed = new Set(boardSubtree(current.boards, activeBoard.id).map(board => board.id))
    const boards = current.boards.map((b) =>
      removed.has(b.id) ? { ...b, trashed: true } : b,
    )
    let next = boards.find((b) => !b.trashed)
    if (!next) {
      next = makeBoard('未命名项目')
      boards.push(next)
    }
    apply({ ...current, boards, activeBoardId: next.id })
    setSelectedId(null)
    setMenu(null)
    notify('画布及其子画布已移到回收站，可以恢复。')
  }

  function editable(
    note: CanvasNote,
    key: 'title' | 'body' | 'label',
    className: string,
  ) {
    return (
      <div
        className={className}
        contentEditable={editingId === note.id}
        suppressContentEditableWarning
        spellCheck={false}
        role={editingId === note.id ? 'textbox' : undefined}
        aria-label={
          editingId === note.id
            ? `${kindNames[note.kind]}${key === 'title' ? '标题' : '内容'}`
            : undefined
        }
        onBlur={(event) => {
          const value = event.currentTarget.innerText
          if (value !== note[key]) updateNote(note.id, { [key]: value })
        }}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (
            event.key === 'Escape' ||
            (event.key === 'Enter' && key !== 'body' && !event.shiftKey)
          ) {
            event.preventDefault()
            event.currentTarget.blur()
            setEditingId(null)
          }
        }}
      >
        {note[key] ?? ''}
      </div>
    )
  }

  function renderNote(note: CanvasNote) {
    if (note.kind === 'board') return <CanvasPortal board={notebook.boards.find(board => board.id === note.childBoardId)} onOpen={() => selectBoard(note.childBoardId!)} />
    if (isWorkbenchNote(note)) return <WorkbenchCard note={note} onOpen={()=>setRichEditing(note)}/>
    if (isRichNote(note))
      return <RichCard note={note} onEdit={() => setRichEditing(note)}
        onRead={() => setReading({ board: activeBoard, noteId: note.id })}
        conversation={!!activeBoard.captures?.some((capture) => capture.noteIds.includes(note.id))} />
    if (note.kind === 'text')
      return (
        <>
          <div className="note-eyebrow">
            <span className="tiny-dot" />
            {editable(note, 'label', 'editable-label')}
            <FileText size={15} />
          </div>
          {editable(note, 'title', 'text-title')}
          {editable(note, 'body', 'text-body')}
          <div className="text-card-footer">
            <span>双击编辑内容</span>
            <MoveUpRight size={15} />
          </div>
        </>
      )
    if (note.kind === 'sticky')
      return (
        <>
          <div className="sticky-top">
            <span className="sticky-tape" />
            <span>{note.title || '灵光一闪'}</span>
            <Sparkles size={15} />
          </div>
          {editable(note, 'body', 'sticky-body')}
          <div className="sticky-bottom">
            {editable(note, 'label', 'sticky-label')}
            <svg viewBox="0 0 50 26" aria-hidden="true">
              <path d="M3 19C19 7 24 23 39 7M32 6l9-2-1 10" />
            </svg>
          </div>
        </>
      )
    if (note.kind === 'image')
      return (
        <>
          <AssetImage note={note} onOpen={() => void openFile(note)} />
          <div className="photo-caption">
            {editable(note, 'title', 'photo-title')}
            <span className="photo-label">
              <span />
              {note.label || '图片附件'}
            </span>
          </div>
        </>
      )
    if (note.kind === 'checklist') {
      const done = note.items?.filter((i) => i.done).length ?? 0
      return (
        <>
          <div className="note-eyebrow">
            <ListChecks size={14} />
            {editable(note, 'label', 'editable-label')}
            <span className="count-pill">
              {done}/{note.items?.length ?? 0}
            </span>
          </div>
          {editable(note, 'title', 'checklist-title')}
          <div className="checklist-items">
            {note.items?.map((item) => (
              <div
                className={`check-row ${item.done ? 'checked' : ''}`}
                key={item.id}
              >
                <button
                  className="checkbox"
                  aria-label={`${item.done ? '取消完成' : '完成'}：${item.text}`}
                  aria-pressed={item.done}
                  onClick={() =>
                    updateNote(note.id, {
                      items: note.items?.map((i) =>
                        i.id === item.id ? { ...i, done: !i.done } : i,
                      ),
                    })
                  }
                >
                  {item.done && <Check size={12} strokeWidth={2.8} />}
                </button>
                <span
                  contentEditable={editingId === note.id}
                  suppressContentEditableWarning
                  onBlur={(event) => {
                    const text = event.currentTarget.innerText
                    if (text !== item.text)
                      updateNote(note.id, {
                        items: note.items?.map((i) =>
                          i.id === item.id ? { ...i, text } : i,
                        ),
                      })
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  {item.text}
                </span>
                {item.priority === 'high' && (
                  <span className="inline-priority" title="高优先级">
                    <span />
                  </span>
                )}
                {item.owner && (
                  <span
                    className="inline-owner"
                    title={`负责人：${item.owner}`}
                  >
                    {item.owner}
                  </span>
                )}
                {item.dueDate && (
                  <span
                    className={`inline-due ${!item.done && item.dueDate < workDate() ? 'overdue' : ''}`}
                    title={`截止 ${item.dueDate}`}
                  >
                    {item.dueDate === workDate()
                      ? '今天'
                      : item.dueDate.slice(5).replace('-', '/')}
                  </span>
                )}
                {editingId === note.id && (
                  <button
                    className="remove-item"
                    title="删除这一项"
                    onClick={() =>
                      updateNote(note.id, {
                        items: note.items?.filter((i) => i.id !== item.id),
                      })
                    }
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="checklist-footer">
            <button
              className="subtle-button"
              onClick={() => {
                updateNote(note.id, {
                  items: [
                    ...(note.items ?? []),
                    { id: uid(), text: '新的待办任务', done: false },
                  ],
                  height: Math.max(
                    note.height,
                    150 + (note.items?.length ?? 0) * 38,
                  ),
                })
                setEditingId(note.id)
              }}
            >
              <Plus size={13} />
              添加一项
            </button>
            <div className="mini-progress">
              <i
                style={{
                  width: `${(done / Math.max(1, note.items?.length ?? 1)) * 100}%`,
                }}
              />
            </div>
          </div>
        </>
      )
    }
    if (note.kind === 'table')
      return (
        <>
          <div className="table-heading">
            <Table2 size={16} />
            {editable(note, 'title', 'table-title')}
            <span>{note.rows?.length ?? 0} 条记录</span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {note.columns?.map((column, col) => (
                    <th
                      key={col}
                      contentEditable={editingId === note.id}
                      suppressContentEditableWarning
                      onBlur={(event) => {
                        const text = event.currentTarget.innerText
                        if (text !== column)
                          updateNote(note.id, {
                            columns: note.columns?.map((c, i) =>
                              i === col ? text : c,
                            ),
                          })
                      }}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {note.rows?.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, colIndex) => (
                      <td key={colIndex}>
                        <span
                          className={
                            ['进行中', '已完成', '计划中', '待开始'].includes(
                              cell,
                            )
                              ? `status-chip status-${cell === '进行中' ? 'green' : cell === '已完成' ? 'purple' : 'gray'}`
                              : cell.includes('✦')
                                ? 'stars-cell'
                                : ''
                          }
                          contentEditable={editingId === note.id}
                          suppressContentEditableWarning
                          onBlur={(event) => {
                            const text = event.currentTarget.innerText
                            if (text !== cell)
                              updateNote(note.id, {
                                rows: note.rows?.map((r, i) =>
                                  i === rowIndex
                                    ? r.map((c, j) =>
                                        j === colIndex ? text : c,
                                      )
                                    : r,
                                ),
                              })
                          }}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          {cell || '\u00a0'}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="table-add"
            onClick={() => {
              updateNote(note.id, {
                rows: [
                  ...(note.rows ?? []),
                  note.columns?.map((_, i) => (i === 0 ? '新的记录' : '')) ??
                    [],
                ],
                height: Math.max(
                  note.height,
                  135 + (note.rows?.length ?? 0) * 43,
                ),
              })
              setEditingId(note.id)
            }}
          >
            <Plus size={13} />
            添加一行
          </button>
        </>
      )
    if (note.kind === 'folder') return <FolderCard note={note} onOpen={() => openFile(note)} />
    if (note.kind === 'file')
      return (
        <>
          <div className="file-main">
            <div className="file-art">
              <FileText size={23} strokeWidth={1.4} />
              <span>
                {note.filename?.split('.').pop()?.slice(0, 4).toUpperCase() ||
                  'FILE'}
              </span>
            </div>
            <div className="file-info">
              <div className="file-name" title={note.filename}>
                {note.filename}
              </div>
              <div className="file-meta">
                {formatSize(note.size)}
                <span>·</span>
                {note.mime?.startsWith('video/')
                  ? '视频'
                  : note.mime?.startsWith('audio/')
                    ? '音频'
                    : '项目文档'}
              </div>
            </div>
            <button
              className="file-download"
              title="查看文件内容"
              aria-label={`查看 ${note.filename}`}
              onClick={() => void openFile(note)}
            >
              <FolderOpen size={15} />
            </button>
          </div>
          <div className="file-footer">
            <span className="tiny-dot" />
            文件已保存 · 点击查看内容
            <CheckCheck size={13} />
          </div>
        </>
      )
    return (
      <>
        <div className="link-top">
          <span className="link-symbol">
            <Link2 size={16} />
          </span>
          <span className="link-site">{note.body || 'WEB / 项目附件'}</span>
          <a
            href={safeUrl(note.url) || undefined}
            target="_blank"
            rel="noreferrer"
            aria-label={`打开 ${note.title}`}
          >
            <ArrowUpRight size={16} />
          </a>
        </div>
        {editable(note, 'title', 'link-title')}
        <div className="link-bottom">
          <span>
            {safeUrl(note.url)
              ? new URL(note.url!).hostname.replace(/^www\./, '')
              : '添加一个网页'}
          </span>
          <span>↗</span>
        </div>
      </>
    )
  }

  const boards = notebook.boards.filter((b) => !b.trashed)
  const visibleBoards = [
    ...orderedBoards(boards.filter((b) => filter !== 'favorites' || b.favorite)),
  ].sort((a, b) =>
    filter === 'recent'
      ? (b.lastOpenedAt ?? b.updatedAt) - (a.lastOpenedAt ?? a.updatedAt)
      : 0,
  )
  const searchResults = [...boards,...agentProjects]
    .flatMap((board) => {
      const query = search.trim().toLowerCase()
      if (!query) return [{ board, note: undefined as CanvasNote | undefined }]
      return [
        ...(board.title.toLowerCase().includes(query)
          ? [{ board, note: undefined as CanvasNote | undefined }]
          : []),
        ...board.notes
          .filter((note) => noteSearchText(note).toLowerCase().includes(query))
          .map((note) => ({ board, note })),
      ]
    })
    .slice(0, 20)

  function focusResult(board: Board, note?: CanvasNote) {
    if(agentProjects.some(project=>project.id===board.id)){
      apply({...notebookRef.current,appMode:'agents',activeAgentProjectId:board.id},false)
      setModal(null);setSearch('');if(note)openAgentNote(note)
      return
    }
    selectBoard(board.id)
    setWorkspaceView('canvas')
    setModal(null)
    setSearch('')
    if (note) {
      setSelectedId(note.id)
      centerNote(note)
    }
  }

  return (
    <>
    <div
      inert={!!presentation}
      aria-hidden={!!presentation || undefined}
      className={`app-shell work-mode ${focusMode ? 'focus-mode' : ''}`}
      style={themeVariables(appearance) as CSSProperties}
      onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        if (appMode==='agents') { notify('文件可拖入自由画布。请先切换到“所有画布”。'); return }
        if (modal || richEditing || preview || reading) { notify('请先关闭当前编辑窗口，再将文件拖到画布。'); return }
        addImport(collectDrop(event.dataTransfer))
      }}
    >
      {sidebarOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="关闭侧栏"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}
        inert={(mobileLayout && !sidebarOpen) || (focusMode && !mobileLayout)}
      >
        <button
          className="brand"
          onClick={() => {
            setAppMode('notes')
            setFilter('all')
            selectBoard(boards[0].id)
          }}
          aria-label="Own 首页"
        >
          <BrandMark />
          <span>
            <strong>Own</strong>
            <small>WORKSPACE</small>
          </span>
        </button>
        <button
          className="workspace-switch"
          onClick={() => setModal('workspace')}
        >
          <span className="workspace-avatar">
            L<span />
          </span>
          <span>
            <strong>我的工作空间</strong>
            <small>项目、任务与资料，一处掌握</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <button
          className="sidebar-search"
          onClick={() => {
            setModal('search')
            setSearch('')
          }}
        >
          <Search size={16} />
          <span>搜索笔记、任务、资料</span>
          <kbd>Ctrl K</kbd>
        </button>
        <nav className="main-nav" aria-label="工作区导航">
          <button className={appMode==='agents'?'nav-active':''} onClick={()=>setAppMode('agents')}><Bot size={17}/><span>Agent Next to do</span></button>
          <button
            className={
              appMode==='notes' && filter === 'all' && workspaceView === 'canvas' ? 'nav-active' : ''
            }
            onClick={() => {
              setAppMode('notes')
              setFilter('all')
              setWorkspaceView('canvas')
            }}
          >
            <LayoutGrid size={17} />
            <span>所有画布</span>
            <span className="nav-count">
              {boards.length.toString().padStart(2, '0')}
            </span>
          </button>
          <button
            className={appMode==='notes' && filter === 'recent' ? 'nav-active' : ''}
            onClick={() => {setAppMode('notes');setFilter('recent')}}
          >
            <Clock3 size={17} />
            <span>最近打开</span>
          </button>
          <button
            className={appMode==='notes' && filter === 'favorites' ? 'nav-active' : ''}
            onClick={() => {setAppMode('notes');setFilter('favorites')}}
          >
            <Star size={17} />
            <span>我的收藏</span>
            <span className="favorite-dot" />
          </button>
        </nav>
        {appMode==='notes'?<><div className="boards-label">
          <span>
            {filter === 'favorites'
              ? '收藏的画布'
              : filter === 'recent'
                ? '最近的画布'
                : '我的画布'}
          </span>
          <IconButton
            label="新建画布"
            onClick={() => {
              setModalTitle('')
              setModal('new')
            }}
          >
            <Plus size={16} />
          </IconButton>
        </div>
        <div className="board-list">
          {visibleBoards.map((board) => {
            const Icon = boardIcons[board.icon] ?? Sparkles
            return (
              <button
                key={board.id}
                className={`board-item ${activeBoard.id === board.id ? 'board-active' : ''}`}
                onClick={() => selectBoard(board.id)}
                style={{ paddingLeft: 12 + Math.min(6, boardTrail(boards, board.id).length - 1) * 14 }}
                title={boardTrail(notebook.boards, board.id).map(board => board.title).join(' / ')}
              >
                <span className={`board-emoji board-emoji-${board.icon}`}>
                  <Icon size={17} strokeWidth={1.7} />
                </span>
                <span>{board.title}</span>
                {board.favorite ? (
                  <Star className="board-star" size={12} fill="currentColor" />
                ) : (
                  <ChevronRight className="board-chevron" size={13} />
                )}
              </button>
            )
          })}
          {!visibleBoards.length && (
            <div className="sidebar-empty">
              点一下画布旁的星星，
              <br />
              把喜欢的想法留在这里。
            </div>
          )}
        </div>
        <button
          className="new-board-button"
          onClick={() => {
            setModalTitle('')
            setModal('new')
          }}
        >
          <Plus size={16} />
          <span>新建画布</span>
        </button>
        </>:<><div className="boards-label"><span>Agent 独立项目</span><button aria-label="新建 Agent 项目" onClick={createAgentProject}><Plus size={16}/></button></div><div className="board-list">{agentProjects.map(project=><button key={project.id} className={`board-item ${agentProject?.id===project.id?'board-active':''}`} onClick={()=>apply({...notebookRef.current,activeAgentProjectId:project.id},false)}><Bot size={17}/><span>{project.title}</span></button>)}</div><button className="new-board-button" onClick={createAgentProject}><Plus size={16}/>新建 Agent 项目</button></>}
        <div className="sidebar-bottom">
          <button
            className="agent-connect-button"
            onClick={() => {
              setModal('agent')
              setSidebarOpen(false)
            }}
          >
            <Bot size={17} />
            <span>连接 Agent</span>
            <span className="agent-connect-tag">MCP</span>
          </button>
          <button
            className="sidebar-task-summary"
            onClick={() => {
              setAppMode('notes')
              setWorkspaceView('tasks')
              setSidebarOpen(false)
            }}
          >
            <span>
              <ListChecks size={16} />
              <strong>{appMode==='agents'?'画布任务':'当前项目任务'}</strong>
              <ArrowUpRight size={14} />
            </span>
            <div>
              <strong>{remainingTasks}</strong>
              <span>项待完成</span>
              <small>
                {doneTasks} / {tasks.length} 已完成
              </small>
            </div>
            <i>
              <span
                style={{
                  width: `${tasks.length ? (doneTasks / tasks.length) * 100 : 0}%`,
                }}
              />
            </i>
          </button>
          <button className="trash-nav" onClick={() => setModal('trash')}>
            <Trash2 size={16} />
            <span>回收站</span>
            <span>{notebook.boards.filter((b) => b.trashed).length || ''}</span>
          </button>
          <div className="sidebar-footer">
            <span>
              <i />
              本地工作空间
            </span>
            <IconButton
              label="使用指南与快捷键"
              onClick={() => setModal('help')}
            >
              <CircleHelp size={17} />
            </IconButton>
          </div>
        </div>
      </aside>

      <main className="main-workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <IconButton
              className="mobile-menu"
              label="展开侧栏"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={19} />
            </IconButton>
            <IconButton
              className="desktop-sidebar-toggle"
              label={focusMode ? '退出专注模式 (F)' : '进入专注模式 (F)'}
              onClick={() => setFocusMode((value) => !value)}
            >
              {focusMode ? (
                <PanelLeftOpen size={18} />
              ) : (
                <PanelLeftClose size={18} />
              )}
            </IconButton>
            <span className="breadcrumb-home">{appMode==='agents'?'Agent Next to do':'我的画布'}</span>
            <ChevronRight size={13} />
            <span className="breadcrumb-current">{appMode==='agents'?(agentProject?.title||'独立工作模式'):activeBoard.title}</span>
            {appMode==='notes'&&<IconButton
              label={activeBoard.favorite ? '取消收藏画布' : '收藏画布'}
              active={activeBoard.favorite}
              className="header-star"
              onClick={() =>
                updateBoard((b) => ({ ...b, favorite: !b.favorite }))
              }
            >
              <Star
                size={15}
                fill={activeBoard.favorite ? 'currentColor' : 'none'}
              />
            </IconButton>}
          </div>
          <div className="topbar-actions">
            {workspaceConflict && (
              <button
                className="conflict-refresh"
                onClick={() => void receiveWorkspace(true)}
              >
                接收更新
              </button>
            )}
            <span className={`save-status ${saveError ? 'save-error' : ''}`}>
              {saving ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <CloudCheck size={15} />
              )}
              <span>
                {saving
                  ? '正在保存'
                  : saveError
                    ? '保存未完成'
                    : '已保存到本机'}
              </span>
            </span>
            {saveError && (
              <IconButton
                label="重试保存"
                onClick={() => {
                  void saveNow()
                }}
              >
                <Redo2 size={15} />
              </IconButton>
            )}
            <span className="toolbar-separator" />
            <IconButton
              label="外观与配色"
              className="appearance-button"
              onClick={openAppearance}
            >
              <Palette size={17} />
            </IconButton>
            <div className="undo-actions">
              <IconButton
                label="撤销 (Ctrl+Z)"
                disabled={!history.current.length}
                onClick={undo}
              >
                <Undo2 size={17} />
              </IconButton>
              <IconButton
                label="重做 (Ctrl+Shift+Z)"
                disabled={!future.current.length}
                onClick={redo}
              >
                <Redo2 size={17} />
              </IconButton>
            </div>
            <button
              className="export-button"
              onClick={() => setModal('export')}
            >
              <Upload size={15} />
              <span>导出</span>
            </button>
            <span className="top-avatar" title="我的工作空间">
              L
            </span>
          </div>
        </header>

        {appMode==='agents'?<AgentStudio key={agentProject?.id||'empty'} project={agentProject} onNew={createAgentProject} onUpdate={patch=>updateAgentProject(p=>({...p,...patch}))} onCreate={createAgentTask} onOpen={openAgentNote} onConnect={()=>setModal('agent')}/>:<><section className="project-header" aria-label="项目信息">
          <div className="board-heading" data-canvas-ui>
            {activeBoard.parentBoardId && <nav className="canvas-breadcrumb" aria-label="画布路径">{boardTrail(notebook.boards, activeBoard.id).map((board, i) => <span key={board.id}>{i > 0 && <ChevronRight size={12} />}{board.id === activeBoard.id ? board.title : <button disabled={!!board.trashed} onClick={() => selectBoard(board.id)}>{board.title}</button>}</span>)}</nav>}
            <div className="board-heading-title">
              <h1
                onDoubleClick={() => {
                  setModalTitle(activeBoard.title)
                  setModal('rename')
                }}
              >
                {activeBoard.title}
                <span className="heading-period">.</span>
              </h1>
              <span className="personal-badge">
                <span />
                个人项目
              </span>
              <div className="board-options-wrap">
                <IconButton
                  label="画布选项"
                  active={menu === 'board'}
                  onClick={() => setMenu(menu === 'board' ? null : 'board')}
                >
                  <Ellipsis size={20} />
                </IconButton>
                {menu === 'board' && (
                  <div className="dropdown board-menu">
                    <button
                      onClick={() => {
                        setModalTitle(activeBoard.title)
                        setModal('rename')
                        setMenu(null)
                      }}
                    >
                      <Pencil size={15} />
                      重命名画布
                    </button>
                    <button
                      onClick={() => {
                        updateBoard((b) => ({ ...b, favorite: !b.favorite }))
                        setMenu(null)
                      }}
                    >
                      <Star size={15} />
                      {activeBoard.favorite ? '取消收藏' : '收藏画布'}
                    </button>
                    <button
                      onClick={() => {
                        fitNotes()
                        setMenu(null)
                      }}
                    >
                      <Expand size={15} />
                      查看全部内容
                    </button>
                    <div className="menu-rule" />
                    <button className="danger" onClick={trashBoard}>
                      <Trash2 size={15} />
                      移到回收站
                    </button>
                  </div>
                )}
              </div>
            </div>
            <p>{activeBoard.description}</p>
          </div>
          <div className="canvas-top-right" data-canvas-ui>
            <button className="quick-capture-button" onClick={() => void startPresentation()} title="全屏展示，临时布局不会保存"><Expand size={15} /><span>演讲模式</span></button>
            <button
              className="quick-capture-button"
              aria-label="快速记录 (Ctrl+Enter)"
              title="快速记录 (Ctrl+Enter)"
              onClick={() => openCapture()}
            >
              <Pencil size={14} />
              <span>快速记录</span>
              <kbd>Ctrl ↵</kbd>
            </button>
            <div className="add-content-wrap">
              <button
                className="add-content-button"
                aria-expanded={menu === 'add'}
                onClick={() => setMenu(menu === 'add' ? null : 'add')}
              >
                <Plus size={16} />
                添加内容
                <ChevronDown size={13} />
              </button>
              {menu === 'add' && (
                <div className="dropdown add-menu">
                  <div className="dropdown-heading">添加到当前画布</div>
                  {(
                    [
                      'board',
                      'text',
                      'sticky',
                      'checklist',
                      'table',
                      'markdown',
                      'latex',
                      'diagram',
                      'chart',
                      'code',
                      'analysis',
                      'image',
                      'file',
                      'folder',
                      'link',
                    ] as NoteKind[]
                  ).map((kind) => {
                    const Icon = kindIcons[kind]
                    return (
                      <button
                        key={kind}
                        onClick={() => {
                          if (kind === 'image') imageInput.current?.click()
                          else if (kind === 'file') fileInput.current?.click()
                          else if (kind === 'folder') folderInput.current?.click()
                          else if (kind === 'link') {
                            const note = addNote(kind)
                            setSelectedId(note.id)
                            setModalTitle('https://')
                            setLinkEditing(note.id)
                          } else addNote(kind)
                          setMenu(null)
                        }}
                      >
                        <Icon size={17} />
                        <span>{kindNames[kind]}</span>
                        {kind === 'text' ? (
                          <kbd>T</kbd>
                        ) : kind === 'sticky' ? (
                          <kbd>N</kbd>
                        ) : null}
                      </button>
                    )
                  })}
                  <div className="menu-rule" />
                  <button
                    onClick={() => {
                      importInput.current?.click()
                      setMenu(null)
                    }}
                  >
                    <FolderOpen size={16} />
                    导入画布备份
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>
        <div className="board-viewbar">
          <div className="board-view-tabs" role="tablist" aria-label="项目视图">
            {(
              [
                {
                  id: 'canvas',
                  label: '自由画布',
                  icon: LayoutGrid,
                  count: activeBoard.notes.length,
                },
                {
                  id: 'tasks',
                  label: '任务清单',
                  icon: ListChecks,
                  count: remainingTasks,
                },
                {
                  id: 'assets',
                  label: '资料库',
                  icon: FolderOpen,
                  count: resourceCount,
                },
              ] as const
            ).map(({ id, label, icon: Icon, count }) => (
              <button
                key={id}
                role="tab"
                aria-selected={workspaceView === id}
                aria-controls={`project-${id}`}
                id={`view-tab-${id}`}
                className={workspaceView === id ? 'view-tab-active' : ''}
                onClick={() => {
                  setWorkspaceView(id)
                  setMenu(null)
                  setContextMenu(null)
                  setEditingId(null)
                }}
              >
                <Icon size={15} />
                <span>{label}</span>
                <small>{count}</small>
              </button>
            ))}
          </div>
          <div className="board-view-actions">
            <span className="board-task-progress">
              <span>
                <i
                  style={{
                    width: `${tasks.length ? (doneTasks / tasks.length) * 100 : 0}%`,
                  }}
                />
              </span>
              {doneTasks} / {tasks.length} 任务完成
            </span>
            {workspaceView === 'canvas' && (
              <>
                <span className="toolbar-separator" />
                <button
                  onClick={tidyBoard}
                  disabled={!activeBoard.notes.length}
                  title="自动整理卡片位置，可以撤销"
                >
                  <AlignStartVertical size={15} />
                  <span>整理画布</span>
                </button>
              </>
            )}
          </div>
        </div>
        <div className="project-body">
          <div
            ref={stageRef}
            id="project-canvas"
            role="tabpanel"
            aria-labelledby="view-tab-canvas"
            inert={workspaceView !== 'canvas'}
            className={`canvas-stage ${workspaceView !== 'canvas' ? 'stage-hidden' : ''} tool-${tool} ${spaceDown ? 'space-pan' : ''} ${interacting ? 'is-interacting' : ''} ${dropActive ? 'is-dropping' : ''}`}
            style={
              {
                '--grid-size': `${24 * view.zoom}px`,
                '--grid-x': `${view.x}px`,
                '--grid-y': `${view.y}px`,
              } as CSSProperties
            }
            onPointerDownCapture={trackTouch}
            onPointerDown={onStagePointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endInteraction}
            onPointerCancel={endInteraction}
            onContextMenu={(event) => {
              if (
                (event.target as HTMLElement).closest(
                  '[data-canvas-ui], [contenteditable="true"]',
                )
              )
                return
              event.preventDefault()
              const rect = stageRef.current!.getBoundingClientRect()
              const nodeId =
                (event.target as HTMLElement)
                  .closest('[data-node]')
                  ?.getAttribute('data-node') ?? undefined
              setContextMenu({
                x: Math.min(event.clientX - rect.left, rect.width - 218),
                y: Math.min(event.clientY - rect.top, rect.height - 245),
                nodeId,
              })
              if (nodeId) setSelectedId(nodeId)
            }}
            onDragEnter={(event) => {
              if (event.dataTransfer.types.includes('Files')) {
                event.preventDefault()
                dragDepth.current++
                setDropActive(true)
              }
            }}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes('Files')) {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'copy'
              }
            }}
            onDragLeave={(event) => {
              event.preventDefault()
              dragDepth.current--
              if (dragDepth.current <= 0) setDropActive(false)
            }}
            onDrop={(event) => {
              event.preventDefault()
              event.stopPropagation()
              dragDepth.current = 0
              setDropActive(false)
              if (event.dataTransfer.types.includes('Files'))
                addImport(collectDrop(event.dataTransfer), canvasPoint(event.clientX, event.clientY))
            }}
          >
            <div
              className="canvas-pan"
              style={{ left: view.x, top: view.y }}
            >
              <div className="canvas-world" style={{ zoom: view.zoom }}>
                <svg className="connections-layer" aria-label="卡片连线">
                  <defs>
                    <marker
                      id="arrowhead"
                      markerWidth="7"
                      markerHeight="7"
                      refX="6"
                      refY="3.5"
                      orient="auto"
                    >
                      <path
                        d="M1 1L6 3.5L1 6"
                        fill="none"
                        stroke="#a8b5a5"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </marker>
                    <marker
                      id="arrowhead-selected"
                      markerWidth="7"
                      markerHeight="7"
                      refX="6"
                      refY="3.5"
                      orient="auto"
                    >
                      <path
                        d="M1 1L6 3.5L1 6"
                        fill="none"
                        stroke="#46775e"
                        strokeWidth="1.2"
                      />
                    </marker>
                  </defs>
                  {activeBoard.connections.map((edge) => {
                    const from = activeBoard.notes.find(
                        (n) => n.id === edge.from,
                      ),
                      to = activeBoard.notes.find((n) => n.id === edge.to)
                    if (!from || !to) return null
                    const { path, label } = connectionGeometry(from, to, edge)
                    const color = edge.color || '#8c99a4'
                    const marker = `edge-arrow-${edge.id}`
                    return (
                      <g
                        key={edge.id}
                        className="connection"
                        onPointerDown={(event) => {
                          event.stopPropagation()
                          setSelectedEdge(edge.id)
                          setSelectedId(null)
                        }}
                      >
                        <defs><marker id={marker} markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto-start-reverse"><path d="M 1 1 L 7 4.5 L 1 8" fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></marker></defs>
                        <path d={path} className="connection-hit" />
                        <path
                          d={path}
                          className={`connection-line ${selectedEdge === edge.id ? 'selected-connection' : ''}`}
                          style={{ stroke: color, strokeDasharray: edge.dashed ? '7 5' : undefined }}
                          markerEnd={edge.arrow !== 'none' ? `url(#${marker})` : undefined}
                          markerStart={edge.arrow === 'both' ? `url(#${marker})` : undefined}
                        />
                        {edge.label && <text className="connection-label" x={label.x} y={label.y - 7} textAnchor="middle"><title>{edge.label}</title>{edge.label.length > 48 ? edge.label.slice(0, 47) + '…' : edge.label}</text>}
                      </g>
                    )
                  })}
                  {connectionDraft && (() => {
                    const from = activeBoard.notes.find((note) => note.id === connectionDraft.from)
                    if (!from) return null
                    const { path } = connectionGeometry(from, { ...connectionDraft.point, width: 0, height: 0 }, { fromSide: connectionDraft.fromSide })
                    return <path d={path} className="connection-draft" />
                  })()}
                </svg>
                {activeBoard.notes.map((note) => (
                  <article
                    key={note.id}
                    data-node={note.id}
                    aria-label={`${kindNames[note.kind]}：${note.title || note.filename || note.body?.slice(0, 20)}`}
                    className={`canvas-note note-${note.kind} ${note.color || note.kind === 'sticky' ? 'note-tinted' : ''} ${selectedId === note.id ? 'note-selected' : ''} ${editingId === note.id ? 'note-editing' : ''} ${connectFrom === note.id ? 'connect-source' : ''}`}
                    style={
                      {
                        left: note.x,
                        top: note.y,
                        width: note.width,
                        height: note.height,
                        ...cardVariables(
                          note.color ??
                            (note.kind === 'sticky' ? '#fff5d9' : '#ffffff'),
                          appearance.accent,
                        ),
                        zIndex: selectedId === note.id ? 5 : 2,
                      } as CSSProperties
                    }
                    onPointerDown={(event) => beginNodeDrag(event, note)}
                    onPointerDownCapture={(event) => {
                      if (tool !== 'connect' || event.button !== 0 || (event.target as Element).closest('.note-floating-toolbar, [data-connection-handle], .resize-handle')) return
                      event.preventDefault(); event.stopPropagation(); clickConnect(note)
                    }}
                    onDoubleClick={(event) => {
                      if (
                        tool === 'connect' ||
                        (event.target as HTMLElement).closest('button,a')
                      )
                        return
                      if (note.kind === 'board') { selectBoard(note.childBoardId!); return }
                      if (isRichNote(note) || isWorkbenchNote(note)) {
                        setSelectedId(note.id)
                        setRichEditing(note)
                        return
                      }
                      if (['file', 'folder', 'image'].includes(note.kind)) { openFile(note); return }
                      setEditingId(note.id)
                      setSelectedId(note.id)
                      const target = event.target as HTMLElement
                      requestAnimationFrame(() => {
                        const field = target.closest(
                          '[contenteditable]',
                        ) as HTMLElement | null
                        field?.focus()
                      })
                    }}
                  >
                    {selectedId === note.id && (
                      <div
                        className={`note-floating-toolbar ${note.y * view.zoom + view.y < 54 * view.zoom ? 'toolbar-below' : ''}`}
                        data-canvas-ui
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        <CardColorMenu
                          color={note.color}
                          defaultColor={
                            note.kind === 'sticky' ? '#fff5d9' : '#ffffff'
                          }
                          onChange={(color) => updateNote(note.id, { color })}
                        />
                        <span className="toolbar-separator" />
                        <IconButton
                          label="编辑卡片（也可双击文字）"
                          onClick={() => {
                            if (note.kind === 'board') { selectBoard(note.childBoardId!); return }
                      if (isRichNote(note) || isWorkbenchNote(note)) {
                              setRichEditing(note)
                              return
                            }
                            if (['file', 'folder', 'image'].includes(note.kind)) {
                              void openFile(note)
                              return
                            }
                            if (note.kind === 'link') {
                              setLinkEditing(note.id)
                              setModalTitle(note.url ?? 'https://')
                              return
                            }
                            setEditingId(note.id)
                            requestAnimationFrame(() =>
                              (
                                document.querySelector(
                                  `[data-node="${note.id}"] [contenteditable="true"]`,
                                ) as HTMLElement | null
                              )?.focus(),
                            )
                          }}
                        >
                          <Pencil size={14} />
                        </IconButton>
                        <IconButton
                          label="连接到另一张卡片"
                          active={connectFrom === note.id}
                          onClick={() => {
                            setTool('connect')
                            setConnectFrom(note.id)
                            notify('点另一张卡片，连接相关内容。')
                          }}
                        >
                          <Link2 size={14} />
                        </IconButton>
                        <IconButton
                          label="复制卡片 (Ctrl+D)"
                          onClick={() => duplicateNote(note.id)}
                        >
                          <Copy size={14} />
                        </IconButton>
                        <IconButton
                          label="删除卡片 (Delete)"
                          onClick={() => removeNote(note.id)}
                        >
                          <Trash2 size={14} />
                        </IconButton>
                      </div>
                    )}
                    {renderNote(note)}
                    {(selectedId === note.id || tool === 'connect' || connectionDraft) && connectionSides.map((side) => (
                      <button key={side} data-connection-handle={side} className={`connection-handle handle-${side}`} aria-label={`从${{ top: '上', right: '右', bottom: '下', left: '左' }[side]}侧拖动连接卡片`} title="拖到另一张卡片以连接" onPointerDown={(event) => beginConnection(event, note, side)} />
                    ))}
                    {!isRichNote(note) && note.source && (
                      <div className="note-conversation-footer" data-canvas-ui onPointerDown={(event) => event.stopPropagation()}>
                        <SourceBadge note={note} />
                        <button className="read-note-button" onClick={() => setReading({ board: activeBoard, noteId: note.id })}>
                          <BookOpen size={13} />阅读会话
                        </button>
                      </div>
                    )}
                    {selectedId === note.id && (
                      <button
                        className="resize-handle"
                        aria-label="拖动调整卡片大小"
                        title="拖动调整大小"
                        onPointerDown={(event) => {
                          event.stopPropagation()
                          interaction.current = {
                            type: 'resize',
                            startX: event.clientX,
                            startY: event.clientY,
                            note: structuredClone(note),
                          }
                          stageRef.current?.setPointerCapture(event.pointerId)
                        }}
                      >
                        <Maximize2 size={10} />
                      </button>
                    )}
                  </article>
                ))}
              </div>
            </div>

            {selectedEdge && activeBoard.connections.find((edge) => edge.id === selectedEdge) && <ConnectionPanel key={selectedEdge} edge={activeBoard.connections.find((edge) => edge.id === selectedEdge)!} onClose={() => setSelectedEdge(null)} onChange={(patch) => updateBoard((board) => ({ ...board, connections: board.connections.map((edge) => edge.id === selectedEdge ? { ...edge, ...patch } : edge) }))} onDelete={() => { updateBoard((board) => ({ ...board, connections: board.connections.filter((edge) => edge.id !== selectedEdge) })); setSelectedEdge(null) }} />}

            {!activeBoard.notes.length && (
              <div className="empty-canvas" data-canvas-ui>
                <span className="empty-illustration">
                  <BrandMark />
                </span>
                <div className="eyebrow">YOUR WORK, IN ONE PLACE</div>
                <h2>开始你的工作画布</h2>
                <p>
                  从笔记、任务清单或项目资料开始。
                  <br />
                  用适合自己的方式，组织工作。
                </p>
                <button onClick={() => addNote('text')}>
                  <Plus size={16} />
                  添加第一条笔记
                </button>
                <span className="empty-shortcut">
                  也可以按 <kbd>T</kbd>，在任意位置开始
                </span>
              </div>
            )}

            <div
              className="creation-toolbar"
              data-canvas-ui
              aria-label="画布工具"
            >
              <IconButton
                label="选择与移动 (V)"
                active={tool === 'select'}
                onClick={() => {
                  setTool('select')
                  setConnectFrom(null)
                }}
              >
                <MousePointer2 size={20} strokeWidth={1.7} />
              </IconButton>
              <span className="tool-rule" />
              <IconButton
                label="文字 (T)，选中后点击画布放置"
                active={tool === 'text'}
                onClick={() => setTool('text')}
              >
                <Type size={20} strokeWidth={1.7} />
              </IconButton>
              <IconButton
                label="便签 (N)，选中后点击画布放置"
                active={tool === 'sticky'}
                onClick={() => setTool('sticky')}
              >
                <StickyNote size={20} strokeWidth={1.7} />
              </IconButton>
              <IconButton
                label="待办清单 (L)"
                active={tool === 'checklist'}
                onClick={() => setTool('checklist')}
              >
                <ListChecks size={20} strokeWidth={1.7} />
              </IconButton>
              <IconButton
                label="表格，选中后点击画布放置"
                active={tool === 'table'}
                onClick={() => setTool('table')}
              >
                <Table2 size={19} strokeWidth={1.7} />
              </IconButton>
              <IconButton
                label="添加图片"
                onClick={() => imageInput.current?.click()}
              >
                <ImagePlus size={20} strokeWidth={1.7} />
              </IconButton>
              <IconButton
                label="添加文件"
                onClick={() => fileInput.current?.click()}
              >
                <File size={19} strokeWidth={1.7} />
              </IconButton>
              <span className="tool-rule" />
              <IconButton
                label="连接内容 (C)，依次点击两张卡片"
                active={tool === 'connect'}
                onClick={() => {
                  setTool('connect')
                  setConnectFrom(null)
                }}
              >
                <MoveUpRight size={20} strokeWidth={1.7} />
              </IconButton>
              <IconButton label="添加文件夹" onClick={() => folderInput.current?.click()}><FolderOpen size={19} strokeWidth={1.7} /></IconButton>
              <IconButton label="公式输入器" onClick={() => addNote('latex')}><Sigma size={19} strokeWidth={1.7} /></IconButton>
              <IconButton label="流程图制作器" onClick={() => addNote('diagram')}><GitBranch size={19} strokeWidth={1.7} /></IconButton>
              <IconButton
                label="漫游画布 (H)，也可按住空格拖动"
                active={tool === 'hand'}
                onClick={() => setTool('hand')}
              >
                <Hand size={19} strokeWidth={1.7} />
              </IconButton>
            </div>

            <div className="canvas-bottom" data-canvas-ui>
              <div className="canvas-tip">
                <span className="tip-symbol">
                  <Sparkles size={14} />
                </span>
                <span>
                  {tool === 'connect' ? (
                    connectFrom ? (
                      '点另一张卡片，让想法相连'
                    ) : (
                      '依次点两张卡片，连接相关内容'
                    )
                  ) : ['text', 'sticky', 'table', 'checklist'].includes(
                      tool,
                    ) ? (
                    '点击画布放置内容'
                  ) : tool === 'hand' || spaceDown ? (
                    '拖动查看画布其他区域'
                  ) : (
                    <>
                      <span className="desktop-tip-full">
                        <span className="desktop-tip">
                          拖入任何内容 · 双击编辑 ·{' '}
                        </span>
                        按住 <kbd>空格</kbd> 自由漫游
                      </span>
                      <span className="mobile-tip">
                        双指缩放 · 拖动空白处漫游
                      </span>
                    </>
                  )}
                </span>
              </div>
              <div className="canvas-layout-controls">
                <button
                  className={`snap-toggle ${snapToGrid ? 'snap-on' : ''}`}
                  aria-pressed={snapToGrid}
                  onClick={() => setSnapToGrid((value) => !value)}
                  title="拖动卡片时吸附到网格"
                >
                  <LayoutGrid size={13} />
                  <span>网格吸附</span>
                  <i />
                </button>
              </div>
              <div className="viewport-controls">
                <IconButton
                  label="缩小 (-)"
                  onClick={() => changeZoom(view.zoom / 1.15)}
                >
                  <Minus size={16} />
                </IconButton>
                <button
                  className="zoom-value"
                  title="恢复 100% 缩放"
                  onClick={() => changeZoom(1)}
                >
                  {Math.round(view.zoom * 100)}
                  <span>%</span>
                </button>
                <IconButton
                  label="放大 (+)"
                  onClick={() => changeZoom(view.zoom * 1.15)}
                >
                  <Plus size={16} />
                </IconButton>
                <span className="toolbar-separator" />
                <IconButton label="适应全部内容 (0)" onClick={() => fitNotes()}>
                  <Expand size={16} />
                </IconButton>
              </div>
            </div>
            {contextMenu && (
              <div
                className="dropdown context-menu"
                data-canvas-ui
                style={{ left: contextMenu.x, top: contextMenu.y }}
                onPointerDown={(event) => event.stopPropagation()}
              >
                {contextMenu.nodeId ? (
                  <>
                    <button onClick={() => duplicateNote(contextMenu.nodeId)}>
                      <Copy size={15} />
                      复制卡片<kbd>Ctrl D</kbd>
                    </button>
                    <button
                      onClick={() => {
                        setTool('connect')
                        setConnectFrom(contextMenu.nodeId!)
                        setContextMenu(null)
                      }}
                    >
                      <Link2 size={15} />
                      连接到其他卡片
                    </button>
                    <div className="menu-rule" />
                    <button
                      className="danger"
                      onClick={() => removeNote(contextMenu.nodeId)}
                    >
                      <Trash2 size={15} />
                      删除卡片
                    </button>
                  </>
                ) : (
                  <>
                    <div className="dropdown-heading">在这里添加内容</div>
                    {(
                      ['text', 'sticky', 'table', 'checklist'] as NoteKind[]
                    ).map((kind) => {
                      const Icon = kindIcons[kind]
                      return (
                        <button
                          key={kind}
                          onClick={() =>
                            addNote(kind, {
                              x: (contextMenu.x - view.x) / view.zoom,
                              y: (contextMenu.y - view.y) / view.zoom,
                            })
                          }
                        >
                          <Icon size={16} />
                          {kindNames[kind]}
                        </button>
                      )
                    })}
                    <div className="menu-rule" />
                    <button
                      onClick={() => {
                        fitNotes()
                        setContextMenu(null)
                      }}
                    >
                      <Expand size={15} />
                      查看全部内容
                    </button>
                  </>
                )}
              </div>
            )}
            {dropActive && (
              <div className="drop-overlay">
                <div>
                  <span>
                    <ArrowDownToLine size={35} />
                  </span>
                  <h2>松开，添加到当前项目</h2>
                  <p>照片、文档、音频、视频……都可以。</p>
                </div>
              </div>
            )}
          </div>
          {workspaceView === 'tasks' && (
            <div
              className="project-view-panel"
              role="tabpanel"
              aria-labelledby="view-tab-tasks"
              id="project-tasks"
            >
              <TaskView
                key={activeBoard.id}
                board={activeBoard}
                onUpdate={updateWorkTask}
                onLocate={locateNote}
                onAdd={addWorkTask}
              />
            </div>
          )}
          {workspaceView === 'assets' && (
            <div
              className="project-view-panel"
              role="tabpanel"
              aria-labelledby="view-tab-assets"
              id="project-assets"
            >
              <ResourceView
                key={activeBoard.id}
                board={activeBoard}
                onOpen={openResource}
                onLocate={locateNote}
                onUpload={() => fileInput.current?.click()}
                onFolder={() => folderInput.current?.click()}
              />
            </div>
          )}
        </div>
        </>}
      </main>

      <input
        ref={imageInput}
        className="hidden-input"
        type="file"
        accept="image/*"
        multiple
        aria-label="选择图片"
        onChange={(event) => {
          if (event.target.files) void addFiles(event.target.files)
          event.target.value = ''
        }}
      />
      <input
        ref={fileInput}
        className="hidden-input"
        type="file"
        multiple
        aria-label="选择文件"
        onChange={(event) => {
          if (event.target.files) void addFiles(event.target.files)
          event.target.value = ''
        }}
      />
      <input
        ref={(element) => { folderInput.current = element; element?.setAttribute('webkitdirectory', '') }}
        className="hidden-input"
        type="file"
        multiple
        aria-label="选择文件夹"
        onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = '' }}
      />
      <input
        ref={importInput}
        className="hidden-input"
        type="file"
        accept=".own,.fieldnotes,.json"
        aria-label="导入画布备份"
        onChange={(event) => {
          void importBackup(event.target.files?.[0])
          event.target.value = ''
        }}
      />

      {modal && (
        <div
          className="modal-overlay"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setModal(null)
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label={
              {
                search: '搜索工作空间',
                new: '开启新画布',
                rename: '重命名画布',
                export: '导出与备份',
                help: '操作指南与快捷键',
                trash: '回收站',
                workspace: '我的工作空间',
                capture: '快速记录',
                appearance: '外观与配色',
                agent: '连接 Agent · MCP',
              }[modal]
            }
            className={`modal modal-${modal}`}
          >
            <IconButton
              className="modal-close"
              label="关闭弹窗"
              onClick={() => setModal(null)}
            >
              <X size={19} />
            </IconButton>
            {modal === 'search' ? (
              <>
                <div className="search-input-wrap">
                  <Search size={21} />
                  <input
                    autoFocus
                    placeholder="搜索项目、笔记、任务或文件…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  <kbd>ESC</kbd>
                </div>
                <div className="search-results">
                  <div className="dropdown-heading">
                    {search.trim()
                      ? `找到 ${searchResults.length} 条结果`
                      : '最近使用的画布'}
                  </div>
                  {searchResults.map(({ board, note }) => {
                    const Icon = note
                      ? kindIcons[note.kind]
                      : (boardIcons[board.icon] ?? Sparkles)
                    return (
                      <button
                        key={`${board.id}-${note?.id ?? 'board'}`}
                        onClick={() => focusResult(board, note)}
                      >
                        <span className="search-result-icon">
                          <Icon size={18} />
                        </span>
                        <span>
                          <strong>
                            {note?.title ||
                              note?.filename ||
                              note?.body?.slice(0, 35) ||
                              board.title}
                          </strong>
                          <small>
                            {note
                              ? `${board.title} · ${kindNames[note.kind]}`
                              : `${board.notes.length} 个内容块 · ${agentProjects.some(p=>p.id===board.id)?'Agent 项目':'画布'}`}
                          </small>
                        </span>
                        <ArrowUpRight size={16} />
                      </button>
                    )
                  })}
                  {!searchResults.length && (
                    <div className="search-no-results">
                      <Search size={30} />
                      <p>没有找到匹配的内容</p>
                      <span>换个关键词，再找找看。</span>
                    </div>
                  )}
                </div>
                <div className="search-footer">
                  <span>搜索当前工作空间中的所有内容</span>
                  <kbd>Ctrl K</kbd>
                </div>
              </>
            ) : modal === 'agent' ? (
              <AgentConnection />
            ) : modal === 'appearance' ? (
              <AppearanceSettings
                value={appearanceDraft ?? defaultAppearance}
                onChange={setAppearanceDraft}
                onCancel={() => setModal(null)}
                onSave={() => {
                  if (appearanceDraft)
                    apply({
                      ...notebookRef.current,
                      appearance: appearanceDraft,
                    })
                  setModal(null)
                  notify('配色已应用。')
                }}
              />
            ) : modal === 'capture' ? (
              <form onSubmit={submitCapture} className="capture-form">
                <span className="modal-illustration">
                  <Pencil size={25} />
                </span>
                <span className="eyebrow">QUICK CAPTURE</span>
                <h2>先记录，继续推进。</h2>
                <p>记录到「{activeBoard.title}」，随时回到上下文。</p>
                <div className="capture-tabs">
                  <button
                    type="button"
                    aria-pressed={captureKind === 'note'}
                    className={captureKind === 'note' ? 'active' : ''}
                    onClick={() => setCaptureKind('note')}
                  >
                    <FileText size={15} />
                    笔记
                  </button>
                  <button
                    type="button"
                    aria-pressed={captureKind === 'task'}
                    className={captureKind === 'task' ? 'active' : ''}
                    onClick={() => setCaptureKind('task')}
                  >
                    <ListChecks size={15} />
                    任务
                  </button>
                </div>
                <textarea
                  autoFocus
                  aria-label={
                    captureKind === 'task' ? '快速任务内容' : '快速笔记内容'
                  }
                  placeholder={
                    captureKind === 'task'
                      ? '需要完成什么？'
                      : '第一行作为标题，接下来记录正文…'
                  }
                  rows={5}
                  value={captureText}
                  onChange={(event) => setCaptureText(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      (event.ctrlKey || event.metaKey) &&
                      event.key === 'Enter'
                    ) {
                      event.preventDefault()
                      submitCapture(event)
                    }
                  }}
                />
                {captureKind === 'task' && (
                  <TaskFields
                    priority={capturePriority}
                    dueDate={captureDue}
                    onPriority={setCapturePriority}
                    onDueDate={setCaptureDue}
                  />
                )}
                <div className="capture-destination">
                  <LayoutGrid size={13} />
                  <span>
                    {captureKind === 'task'
                      ? '保存到当前项目的待办清单'
                      : '保存到当前项目画布'}
                  </span>
                  <kbd>Ctrl ↵</kbd>
                </div>
                <div className="modal-form-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setModal(null)}
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={!captureText.trim()}
                  >
                    保存{captureKind === 'task' ? '任务' : '笔记'}
                    <ArrowRight size={15} />
                  </button>
                </div>
              </form>
            ) : modal === 'new' || modal === 'rename' ? (
              <form onSubmit={submitBoard}>
                <span className="modal-illustration">
                  <LayoutTemplate size={27} strokeWidth={1.5} />
                </span>
                <span className="eyebrow">NEW WORKSPACE</span>
                <h2>{modal === 'new' ? '新建工作画布' : '重命名工作画布'}</h2>
                <p>
                  {modal === 'new'
                    ? '选择适合当前工作的模板，马上开始。'
                    : '为当前工作画布设置一个清晰的名称。'}
                </p>
                {modal === 'new' && (
                  <div className="board-template-options">
                    {(
                      [
                        {
                          id: 'blank',
                          icon: LayoutGrid,
                          title: '空白画布',
                          detail: '自由组织内容',
                        },
                        {
                          id: 'project',
                          icon: Briefcase,
                          title: '项目计划',
                          detail: '目标、任务与里程碑',
                        },
                        {
                          id: 'meeting',
                          icon: CalendarDays,
                          title: '会议记录',
                          detail: '讨论、决策与行动',
                        },
                      ] as const
                    ).map(({ id, icon: Icon, title, detail }) => (
                      <button
                        type="button"
                        key={id}
                        className={boardTemplate === id ? 'selected' : ''}
                        aria-pressed={boardTemplate === id}
                        onClick={() => setBoardTemplate(id)}
                      >
                        <Icon size={20} />
                        <strong>{title}</strong>
                        <small>{detail}</small>
                        {boardTemplate === id && <Check size={12} />}
                      </button>
                    ))}
                  </div>
                )}
                <label className="field-label" htmlFor="board-name">
                  画布名称
                </label>
                <input
                  id="board-name"
                  className="modal-text-input"
                  placeholder="例如：Q4 产品规划"
                  maxLength={60}
                  autoFocus
                  value={modalTitle}
                  onChange={(event) => setModalTitle(event.target.value)}
                />
                <div className="modal-form-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setModal(null)}
                  >
                    取消
                  </button>
                  <button
                    className="primary-button"
                    disabled={!modalTitle.trim()}
                    type="submit"
                  >
                    {modal === 'new' ? '创建画布' : '保存名称'}
                    <ArrowRight size={15} />
                  </button>
                </div>
              </form>
            ) : modal === 'export' ? (
              <>
                <span className="modal-illustration">
                  <Upload size={28} strokeWidth={1.5} />
                </span>
                <span className="eyebrow">EXPORT YOUR WORK</span>
                <h2>导出与备份</h2>
                <p>备份项目内容与附件，或导出 Markdown。</p>
                <button
                  className="export-option"
                  disabled={exporting}
                  onClick={() => void exportBackup()}
                >
                  <span className="export-option-icon">
                    {exporting ? (
                      <LoaderCircle className="spin" size={25} />
                    ) : (
                      <FolderOpen size={25} />
                    )}
                  </span>
                  <span>
                    <strong>
                      {exporting ? '正在打包工作内容…' : '完整备份'}
                      <span className="recommended-badge">推荐</span>
                    </strong>
                    <small>全部画布、排布和附件 · .own</small>
                  </span>
                  <Download size={18} />
                </button>
                <button className="export-option" onClick={exportMarkdown}>
                  <span className="export-option-icon markdown-icon">
                    <FileText size={25} />
                  </span>
                  <span>
                    <strong>导出这块画布的文字</strong>
                    <small>文字、待办和表格 · Markdown</small>
                  </span>
                  <Download size={18} />
                </button>
                <div className="export-import">
                  <span>已经有一份 Own 备份？</span>
                  <button onClick={() => importInput.current?.click()}>
                    导入画布
                    <ArrowUpRight size={13} />
                  </button>
                </div>
              </>
            ) : modal === 'help' ? (
              <>
                <span className="modal-illustration">
                  <Focus size={26} />
                </span>
                <span className="eyebrow">A FEW LITTLE THINGS</span>
                <h2>操作指南与快捷键。</h2>
                <p>从记录到执行，用更少的步骤完成。</p>
                <div className="help-grid">
                  <div>
                    <MousePointer2 size={20} />
                    <strong>随心摆放</strong>
                    <span>拖动卡片移动，拖动右下角调整大小。</span>
                  </div>
                  <div>
                    <Pencil size={20} />
                    <strong>想改就改</strong>
                    <span>双击文字编辑，点空白处收起编辑状态。</span>
                  </div>
                  <div>
                    <Hand size={20} />
                    <strong>无边漫游</strong>
                    <span>按住空格拖动画布，Ctrl + 滚轮缩放。</span>
                  </div>
                  <div>
                    <Link2 size={20} />
                    <strong>连接内容</strong>
                    <span>选中连线工具，再依次点两张卡片。</span>
                  </div>
                </div>
                <div className="shortcut-list">
                  {[
                    ['选择', 'V'],
                    ['文字', 'T'],
                    ['便签', 'N'],
                    ['连线', 'C'],
                    ['漫游', 'H'],
                    ['查看全部', '0'],
                    ['搜索', 'Ctrl K'],
                    ['快速记录', 'Ctrl Enter'],
                    ['专注模式', 'F'],
                    ['撤销', 'Ctrl Z'],
                  ].map(([name, key]) => (
                    <div key={name}>
                      <span>{name}</span>
                      <kbd>{key}</kbd>
                    </div>
                  ))}
                </div>
                <div className="help-note">
                  <CloudCheck size={16} />
                  <span>
                    内容与附件自动保存在本机，浏览器保留缓存。可导出完整备份。
                  </span>
                </div>
              </>
            ) : modal === 'trash' ? (
              <>
                <span className="modal-illustration">
                  <Trash2 size={26} />
                </span>
                <h2>回收站</h2>
                <p>已删除的画布可以在这里恢复。</p>
                <div className="trash-list">
                  {notebook.boards
                    .filter((b) => b.trashed)
                    .map((board) => (
                      <div key={board.id}>
                        <span className="search-result-icon">
                          <LayoutGrid size={18} />
                        </span>
                        <span>
                          <strong>{board.title}</strong>
                          <small>{board.notes.length} 个内容块</small>
                        </span>
                        <button
                          onClick={() => {
                            const current = notebookRef.current
                            apply({
                              ...current,
                              boards: current.boards.map((b) =>
                                [...boardTrail(current.boards, board.id), ...boardSubtree(current.boards, board.id)].some(restored => restored.id === b.id)
                                  ? { ...b, trashed: false }
                                  : b,
                              ),
                              activeBoardId: board.id,
                            })
                            setModal(null)
                            notify('画布已恢复。')
                          }}
                        >
                          恢复画布
                          <ArrowUpRight size={14} />
                        </button>
                      </div>
                    ))}
                  {!notebook.boards.some((b) => b.trashed) && (
                    <div className="trash-empty">
                      <Sprout size={37} strokeWidth={1.3} />
                      <span>回收站为空</span>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <BrandMark />
                <span className="eyebrow workspace-eyebrow">
                  PERSONAL WORKSPACE
                </span>
                <h2>我的工作空间</h2>
                <p>项目、任务与资料，一处掌握。</p>
                <div className="workspace-stats">
                  <div>
                    <strong>{boards.length}</strong>
                    <span>块工作画布</span>
                  </div>
                  <div>
                    <strong>
                      {boards.reduce(
                        (sum, board) => sum + board.notes.length,
                        0,
                      )}
                    </strong>
                    <span>个内容块</span>
                  </div>
                  <div>
                    <strong>∞</strong>
                    <span>自由空间</span>
                  </div>
                </div>
                <div className="workspace-local">
                  <CloudCheck size={21} />
                  <div>
                    <strong>安放在本机，随时可记录</strong>
                    <span>
                      {serverConnected()
                        ? '笔记和附件保存在本机，浏览器保留缓存。'
                        : '本地服务尚未连接，正在使用浏览器缓存。'}
                    </span>
                  </div>
                </div>
                {recoveryAvailable && (
                  <button
                    className="secondary-button recovery-button"
                    onClick={() => {
                      void restoreUnsavedNotes()
                    }}
                  >
                    恢复未保存的浏览器记录
                    <Undo2 size={14} />
                  </button>
                )}
                <button
                  className="primary-button full-width"
                  onClick={() => setModal('export')}
                >
                  管理备份与导入
                  <ArrowRight size={16} />
                </button>
              </>
            )}
          </section>
        </div>
      )}

      {linkEditing && (
        <div
          className="modal-overlay"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setLinkEditing(null)
          }}
        >
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="编辑网页链接"
            onSubmit={(event) => {
              event.preventDefault()
              const url = safeUrl(modalTitle)
              if (!url) {
                notify('请填写一个以 https:// 或 http:// 开头的网页地址。')
                return
              }
              updateNote(linkEditing, {
                url,
                body: new URL(url).hostname.toUpperCase(),
              })
              setLinkEditing(null)
              notify('链接已保存。')
            }}
          >
            <IconButton
              className="modal-close"
              label="关闭链接编辑"
              onClick={() => setLinkEditing(null)}
            >
              <X size={19} />
            </IconButton>
            <span className="modal-illustration">
              <Link2 size={28} />
            </span>
            <h2>添加参考链接</h2>
            <p>保存外部文档或参考页面。</p>
            <label className="field-label" htmlFor="link-url">
              网页地址
            </label>
            <input
              id="link-url"
              type="url"
              autoFocus
              required
              className="modal-text-input"
              value={modalTitle}
              onChange={(event) => setModalTitle(event.target.value)}
              placeholder="https://"
            />
            <div className="modal-form-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setLinkEditing(null)}
              >
                取消
              </button>
              <button className="primary-button" type="submit">
                保存链接
                <ArrowRight size={15} />
              </button>
            </div>
          </form>
        </div>
      )}

      {reading && <ConversationReader board={reading.board} noteId={reading.noteId} onClose={() => setReading(null)} />}

      {richEditing && !isWorkbenchNote(richEditing) && (
        <RichEditor
          key={richEditing.id}
          note={richEditing}
          onClose={() => setRichEditing(null)}
          onSave={(patch) => {
            saveEditorNote(richEditing.id, patch)
            setRichEditing(null)
            notify('卡片已更新。')
          }}
        />
      )}
      {richEditing && isWorkbenchNote(richEditing) && <WorkbenchEditor key={richEditing.id} note={richEditing} destination={appMode==='agents'?'项目':'画布'} board={appMode==='agents'&&agentProject?agentProject:activeBoard} onClose={()=>setRichEditing(null)} onSave={patch=>{saveEditorNote(richEditing.id,patch);setRichEditing(null)}} onChart={addEditorChart}/>}

      {preview && <FileLibrary key={preview.id} note={preview} onClose={() => setPreview(null)} onExtract={(file) => {
        if(appMode==='agents'){updateAgentProject(project=>({...project,notes:[...project.notes,{...makeNote('file',0,0),assetId:file.assetId,title:file.title,filename:file.filename,mime:file.mime,size:file.size}]}));setPreview(null);return}
        const point = canvasPoint(stageSize.width / 2 + (stageRef.current?.getBoundingClientRect().left || 0), stageSize.height / 2 + (stageRef.current?.getBoundingClientRect().top || 0))
        const copy = { ...makeNote('file', point.x, point.y), assetId: file.assetId, title: file.title, filename: file.filename, mime: file.mime, size: file.size }
        updateBoard((board) => ({ ...board, notes: [...board.notes, copy] }))
        setSelectedId(copy.id); setPreview(null); setWorkspaceView('canvas')
      }} />}
      {importing && <div className="import-progress" role="status"><LoaderCircle className="spinning" size={18} /><div><strong>正在收进笔记 {importing.total ? `${importing.done} / ${importing.total}` : ''}</strong><span>{importing.name}</span></div></div>}
      {!!importErrors.length && <aside className="import-errors" role="alert"><header><strong>{importErrors.length} 项未能导入</strong><button aria-label="关闭导入结果" onClick={() => setImportErrors([])}><X size={16} /></button></header><p>已成功保存的内容保留在画布中。以下文件可处理后重新导入。</p><ul>{importErrors.map((error, index) => <li key={index}>{error}</li>)}</ul></aside>}
      {toast && (
        <div className="toast" role="status">
          <span>
            <Check size={14} />
          </span>
          {toast}
        </div>
      )}
    </div>
    {presentation && createPortal(<Presentation initial={presentation} appearance={appearance} onClose={() => { setPresentation(null); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[title="全屏展示，临时布局不会保存"]')?.focus()) }} />, document.body)}
    </>
  )
}
