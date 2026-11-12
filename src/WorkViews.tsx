import { useState } from 'react'
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCheck,
  FileText,
  Flag,
  FolderOpen,
  Image,
  Link2,
  ListChecks,
  Plus,
  Search,
  Target,
} from 'lucide-react'
import type { Board, CanvasNote, TaskItem } from './model'
import { workDate } from './model'

export type WorkspaceView = 'canvas' | 'tasks' | 'assets'
export type TaskDraft = Pick<TaskItem, 'text' | 'priority' | 'dueDate'>

export function boardTasks(board: Board) {
  return board.notes.flatMap((note) =>
    (note.items ?? []).map((item) => ({ note, item })),
  )
}

export function TaskFields({
  priority,
  dueDate,
  onPriority,
  onDueDate,
}: {
  priority: TaskItem['priority']
  dueDate: string
  onPriority: (priority: TaskItem['priority']) => void
  onDueDate: (date: string) => void
}) {
  return (
    <div className="task-fields">
      <label>
        <Flag size={14} />
        <select
          aria-label="任务优先级"
          value={priority ?? 'medium'}
          onChange={(event) =>
            onPriority(event.target.value as TaskItem['priority'])
          }
        >
          <option value="high">高优先级</option>
          <option value="medium">中优先级</option>
          <option value="low">低优先级</option>
        </select>
      </label>
      <label>
        <CalendarDays size={14} />
        <input
          type="date"
          aria-label="任务截止日期"
          value={dueDate}
          onChange={(event) => onDueDate(event.target.value)}
          onBlur={(event) => {
            if (event.target.value !== dueDate) onDueDate(event.target.value)
          }}
        />
      </label>
    </div>
  )
}

export function TaskView({
  board,
  onUpdate,
  onLocate,
  onAdd,
}: {
  board: Board
  onUpdate: (noteId: string, itemId: string, patch: Partial<TaskItem>) => void
  onLocate: (note: CanvasNote) => void
  onAdd: (draft: TaskDraft) => void
}) {
  const [filter, setFilter] = useState<'all' | 'open' | 'done'>('open')
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [priority, setPriority] = useState<TaskItem['priority']>('medium')
  const [dueDate, setDueDate] = useState('')
  const tasks = boardTasks(board)
  const today = workDate()
  const done = tasks.filter(({ item }) => item.done).length
  const dueToday = tasks.filter(
    ({ item }) => !item.done && item.dueDate && item.dueDate <= today,
  ).length
  const visible = tasks.filter(
    ({ item }) =>
      (filter === 'all' || (filter === 'done' ? item.done : !item.done)) &&
      item.text.toLowerCase().includes(query.toLowerCase()),
  )

  return (
    <section className="work-view task-view" aria-label="项目任务清单">
      <div className="work-view-title">
        <div>
          <span className="section-overline">TASKS</span>
          <h2>把计划，变成进展。</h2>
          <p>画布中的所有待办，在这里集中跟进。</p>
        </div>
        <span className="view-decoration">
          <ListChecks size={32} strokeWidth={1.4} />
        </span>
      </div>
      <div className="task-stats">
        <div>
          <span className="stat-icon stat-blue">
            <ListChecks size={18} />
          </span>
          <span>
            <small>待处理</small>
            <strong>
              {tasks.length - done}
              <em>项任务</em>
            </strong>
          </span>
        </div>
        <div>
          <span className="stat-icon stat-orange">
            <CalendarDays size={18} />
          </span>
          <span>
            <small>今日到期 / 已逾期</small>
            <strong>
              {dueToday}
              <em>项待跟进</em>
            </strong>
          </span>
        </div>
        <div>
          <span className="stat-icon stat-green">
            <CheckCheck size={18} />
          </span>
          <span>
            <small>已完成</small>
            <strong>
              {done}
              <em>/ {tasks.length} 项</em>
            </strong>
          </span>
        </div>
      </div>
      <div className="task-list-card">
        <div className="task-list-toolbar">
          <div className="view-filters">
            {(
              [
                ['open', '待处理', tasks.length - done],
                ['all', '全部', tasks.length],
                ['done', '已完成', done],
              ] as const
            ).map(([value, label, count]) => (
              <button
                key={value}
                className={filter === value ? 'active' : ''}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
                <span>{count}</span>
              </button>
            ))}
          </div>
          <label className="view-search">
            <Search size={15} />
            <input
              placeholder="搜索任务…"
              aria-label="搜索项目任务"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
        <div className="task-table-heading">
          <span>任务名称</span>
          <span>来源清单</span>
          <span>优先级</span>
          <span>截止日期</span>
          <span />
        </div>
        {visible.map(({ note, item }) => (
          <div
            key={`${note.id}-${item.id}`}
            data-task-id={item.id}
            className={`work-task-row ${item.done ? 'task-done' : ''}`}
          >
            <div className="work-task-name">
              <button
                role="checkbox"
                aria-checked={item.done}
                className="work-task-checkbox"
                aria-label={`${item.done ? '取消完成' : '完成'}：${item.text}`}
                onClick={() => onUpdate(note.id, item.id, { done: !item.done })}
              >
                {item.done && <Check size={12} strokeWidth={2.5} />}
              </button>
              <input
                key={item.text}
                aria-label={`任务名称：${item.text}`}
                defaultValue={item.text}
                onBlur={(event) => {
                  const text = event.target.value.trim()
                  if (text && text !== item.text)
                    onUpdate(note.id, item.id, { text })
                  else if (!text) event.target.value = item.text
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
              />
              {item.owner && (
                <span className="task-owner" title={`负责人：${item.owner}`}>
                  {item.owner}
                </span>
              )}
            </div>
            <button
              className="task-source"
              onClick={() => onLocate(note)}
              title="在画布中查看来源"
            >
              <ListChecks size={13} />
              <span>{note.title || '待办清单'}</span>
            </button>
            <label
              className={`task-priority priority-${item.priority ?? 'medium'}`}
            >
              <Flag size={12} />
              <select
                aria-label={`${item.text}的优先级`}
                value={item.priority ?? 'medium'}
                onChange={(event) =>
                  onUpdate(note.id, item.id, {
                    priority: event.target.value as TaskItem['priority'],
                  })
                }
              >
                <option value="high">高优先级</option>
                <option value="medium">中优先级</option>
                <option value="low">低优先级</option>
              </select>
            </label>
            <label
              className={`task-date ${!item.done && item.dueDate && item.dueDate < today ? 'is-overdue' : ''}`}
            >
              <CalendarDays size={13} />
              <input
                type="date"
                aria-label={`${item.text}的截止日期`}
                value={item.dueDate ?? ''}
                onChange={(event) =>
                  onUpdate(note.id, item.id, {
                    dueDate: event.target.value || undefined,
                  })
                }
                onBlur={(event) => {
                  if (event.target.value !== (item.dueDate ?? ''))
                    onUpdate(note.id, item.id, {
                      dueDate: event.target.value || undefined,
                    })
                }}
              />
            </label>
            <button
              className="task-locate"
              aria-label={`在画布中查看 ${item.text}`}
              onClick={() => onLocate(note)}
            >
              <ArrowUpRight size={16} />
            </button>
          </div>
        ))}
        {!visible.length && (
          <div className="work-view-empty">
            <Target size={30} strokeWidth={1.4} />
            <strong>
              {query
                ? '没有匹配的任务'
                : filter === 'open'
                  ? '待办已清空，可以开始下一步。'
                  : '这里还没有任务'}
            </strong>
            <span>
              {query
                ? '试试其他关键词。'
                : '在下方添加任务，或在画布中创建待办清单。'}
            </span>
          </div>
        )}
        <form
          className="inline-task-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (!draft.trim()) return
            onAdd({
              text: draft.trim(),
              priority,
              dueDate: dueDate || undefined,
            })
            setDraft('')
            setFilter('open')
          }}
        >
          <div className="inline-task-main">
            <Plus size={17} />
            <input
              aria-label="新任务名称"
              placeholder="添加任务，按 Enter 保存…"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button type="submit" disabled={!draft.trim()}>
              添加任务
              <ArrowUpRight size={13} />
            </button>
          </div>
          <TaskFields
            priority={priority}
            dueDate={dueDate}
            onPriority={setPriority}
            onDueDate={setDueDate}
          />
        </form>
      </div>
      <div className="work-view-footnote">
        <CheckCheck size={14} />
        这里的修改会同步到画布，支持撤销。
      </div>
    </section>
  )
}

export function ResourceView({
  board,
  onOpen,
  onLocate,
  onUpload,
  onFolder,
}: {
  board: Board
  onOpen: (note: CanvasNote) => void
  onLocate: (note: CanvasNote) => void
  onUpload: () => void
  onFolder: () => void
}) {
  const [filter, setFilter] = useState<'all' | 'image' | 'file' | 'folder' | 'link'>('all')
  const [query, setQuery] = useState('')
  const resources = board.notes.filter((note) =>
    ['image', 'file', 'folder', 'link'].includes(note.kind),
  )
  const visible = resources.filter(
    (note) =>
      (filter === 'all' || note.kind === filter) &&
      `${note.title ?? ''} ${note.filename ?? ''} ${note.url ?? ''} ${(note.entries || []).map((entry) => entry.path).join(' ')}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  )
  return (
    <section className="work-view resource-view" aria-label="项目资料库">
      <div className="work-view-title">
        <div>
          <span className="section-overline">RESOURCES</span>
          <h2>项目资料，随时就绪。</h2>
          <p>图片、文档与参考链接，都在同一个地方。</p>
        </div>
        <div className="resource-upload-actions"><button className="resource-upload" onClick={onFolder}><FolderOpen size={16} />添加文件夹</button><button className="resource-upload" onClick={onUpload}>
          <Plus size={16} />
          添加文件
        </button></div>
      </div>
      <div className="resource-toolbar">
        <div className="view-filters">
          {(
            [
              ['all', '全部资料'],
              ['file', '文档文件'],
              ['folder', '文件夹'],
              ['image', '图片'],
              ['link', '链接'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={filter === value ? 'active' : ''}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
              <span>
                {
                  resources.filter(
                    (note) => value === 'all' || note.kind === value,
                  ).length
                }
              </span>
            </button>
          ))}
        </div>
        <label className="view-search">
          <Search size={15} />
          <input
            aria-label="搜索项目资料"
            placeholder="搜索资料…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      <div className="resource-grid">
        {visible.map((note) => {
          const Icon =
            note.kind === 'image'
              ? Image
              : note.kind === 'link'
                ? Link2
                : note.kind === 'folder' ? FolderOpen : FileText
          return (
            <article
              className={`resource-card resource-${note.kind}`}
              key={note.id}
            >
              <button
                className="resource-card-preview"
                aria-label={`打开资料 ${note.title || note.filename}`}
                onClick={() => onOpen(note)}
              >
                <span className="resource-type-mark">
                  <Icon size={32} strokeWidth={1.35} />
                </span>
                <span className="resource-extension">
                  {note.kind === 'image'
                    ? 'IMAGE'
                    : note.kind === 'link'
                      ? 'LINK'
                      : note.kind === 'folder' ? 'FOLDER' : note.filename?.split('.').pop()?.toUpperCase() ||
                        'FILE'}
                </span>
              </button>
              <div className="resource-card-info">
                <strong>{note.title || note.filename || '未命名资料'}</strong>
                <span>
                  {note.kind === 'image'
                    ? '图片 · 点击预览'
                    : note.kind === 'link'
                      ? note.url
                      : note.kind === 'folder' ? `${note.entries?.filter((entry) => entry.kind === 'file').length || 0} 个文件 · 点击浏览内容` : `${note.size ? Math.max(1, Math.round(note.size / 1024)) + ' KB · ' : ''}项目附件`}
                </span>
                <button onClick={() => onLocate(note)}>
                  <span>在画布中查看</span>
                  <ArrowUpRight size={14} />
                </button>
              </div>
            </article>
          )
        })}
      </div>
      {!visible.length && (
        <div className="work-view-empty">
          <FolderOpen size={34} strokeWidth={1.4} />
          <strong>{query ? '没有找到相关资料' : '把相关资料收集到这里'}</strong>
          <span>
            {query
              ? '试试其他关键词，或切换资料类型。'
              : '添加文件或图片后，会自动出现在资料库中。'}
          </span>
        </div>
      )}
      <div className="work-view-footnote">
        <FolderOpen size={14} />共 {resources.length} 份资料 ·
        文件保存在当前设备
      </div>
    </section>
  )
}
