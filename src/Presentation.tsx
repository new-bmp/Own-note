import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { ArrowLeft, ChevronRight, Expand, FileText, FolderOpen, LayoutGrid, Minus, Plus, RotateCcw, X } from 'lucide-react'
import type { Appearance, CanvasNote, Viewport } from './model'
import { RichPreview } from './RichContent'
import { FileContent, FileLibrary } from './FileLibrary'
import { CanvasPortal } from './CanvasPortal'
import { cardVariables, themeVariables } from './appearance'
import { getAsset } from './storage'
import { setPresentationFullscreen } from './desktop'
import { movePresentationNote, presentationFit } from './presentation-state'
import type { PresentationSession } from './presentation-state'
import { boardTrail } from '../shared/canvas-tree.js'
import { connectionGeometry } from '../shared/connections.js'
import { aggregate, filterRows, numeric, parseDataset, summarize } from '../shared/data-analysis.js'

function Picture({ note }: { note: CanvasNote }) {
  const [src, setSrc] = useState(note.src)
  useEffect(() => {
    let active = true, url = ''
    if (note.assetId) void getAsset(note.assetId).then(blob => { if (active && blob) { url = URL.createObjectURL(blob); setSrc(url) } }).catch(() => {})
    return () => { active = false; if (url) URL.revokeObjectURL(url) }
  }, [note.assetId])
  return src ? <img className="presentation-picture" src={src} alt={note.title || note.filename || '图片'} draggable={false} /> : <p>图片暂不可用</p>
}

function ReadTable({ columns = [], rows = [] }: { columns?: string[]; rows?: string[][] }) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(rows.length / 50)), current = Math.min(page, pages - 1)
  return <div className="presentation-table"><div className="presentation-table-scroll"><table><thead><tr>{columns.map((column, i) => <th key={i}>{column}</th>)}</tr></thead><tbody>{rows.slice(current * 50, (current + 1) * 50).map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>{rows.length > 50 && <nav data-presentation-ui><button disabled={!current} onClick={() => setPage(current - 1)}>上一页</button><span>{current + 1} / {pages} · 共 {rows.length} 行</span><button disabled={current === pages - 1} onClick={() => setPage(current + 1)}>下一页</button></nav>}</div>
}

function AnalysisReading({ note }: { note: CanvasNote }) {
  const parsed = useMemo(() => {
    try {
      const data = parseDataset(note.analysisSource || '', note.analysisFormat), settings = note.analysisSettings || {}
      let rows = settings.filter ? filterRows(data.rows, settings.filter.column, settings.filter.operator, settings.filter.value) : data.rows
      if (settings.sort && settings.sort.column >= 0 && settings.sort.column < data.columns.length) {
        const { column, ascending } = settings.sort
        rows = [...rows].sort((a, b) => {
          const av = numeric(a[column]), bv = numeric(b[column])
          return (av !== undefined && bv !== undefined ? av - bv : a[column].localeCompare(b[column], 'zh-CN', { numeric: true })) * (ascending ? 1 : -1)
        })
      }
      const stats = summarize(data.columns, rows)
      const sample = data.rows.slice(0, 100)
      const categories = data.columns.map((_, i) => ({ i, count: new Set(sample.map(row => row[i])).size, numeric: sample.some(row => numeric(row[i]) !== undefined) })).filter(column => !column.numeric)
      const defaultGroup = (categories.find(column => column.count > 1 && column.count < sample.length) || categories[0])?.i || 0
      const defaultValue = data.columns.findIndex((_, i) => sample.some(row => numeric(row[i]) !== undefined))
      const group = Math.max(0, Math.min(settings.group ?? defaultGroup, data.columns.length - 1))
      const value = Math.max(0, Math.min(settings.value ?? (defaultValue < 0 ? Math.min(1, data.columns.length - 1) : defaultValue), data.columns.length - 1))
      const groups = aggregate(rows, group, value, settings.method || 'sum')
      if (settings.order === 'value') groups.sort((a, b) => b.value - a.value)
      if (settings.order === 'label') groups.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN', { numeric: true }))
      return { data, rows, stats, groups, chart: { type: settings.chartType || 'bar', labels: groups.slice(0, 60).map(row => row.label), series: [{ name: `${data.columns[value]} · ${settings.method || 'sum'}`, values: groups.slice(0, 60).map(row => row.value) }] } as CanvasNote['chart'] }
    } catch (error) { return { error: (error as Error).message } }
  }, [note])
  if (!parsed.data) return <><p>{parsed.error}</p><pre>{note.analysisSource}</pre></>
  return <><p>原始数据 {parsed.data.rows.length} 行 · 当前筛选 {parsed.rows!.length} 行 · {parsed.data.columns.length} 列</p>
    {!!parsed.groups?.length && <><RichPreview note={{ ...note, kind: 'chart', chart: parsed.chart }} />{parsed.groups.length > 60 && <p>图中展示前 60 组，完整数据可在下表中翻页查看。</p>}</>}
    <h3>数据</h3><ReadTable columns={parsed.data.columns} rows={parsed.rows} />
    <h3>统计</h3><ReadTable columns={['列', '有效值', '空值', '不同值', '均值', '最小', '最大']} rows={parsed.stats!.map(column => [column.name, String(column.count), String(column.missing), String(column.unique), String(column.mean ?? '—'), String(column.min ?? '—'), String(column.max ?? '—')])} />
    <details><summary>完整原始数据</summary><pre>{note.analysisSource}</pre></details></>
}

function NoteReading({ note, detail = false }: { note: CanvasNote; detail?: boolean }) {
  if (['markdown', 'latex', 'diagram', 'chart'].includes(note.kind)) return <><RichPreview note={note} />{note.caption && <p className="presentation-caption">{note.caption}</p>}{detail && note.kind === 'chart' && note.chart && <ReadTable columns={['项目', ...note.chart.series.map(series => series.name)]} rows={note.chart.labels.map((label, i) => [label, ...note.chart!.series.map(series => String(series.values[i]))])} />}</>
  if (note.kind === 'image') return detail ? <FileContent note={note} readOnly /> : <Picture note={note} />
  if (note.kind === 'file') return detail ? <FileContent note={note} readOnly /> : <div className="presentation-file"><FileText size={42} /><strong>{note.filename || note.title}</strong><p>双击查看完整内容</p></div>
  if (note.kind === 'folder') return <div className="presentation-file"><FolderOpen size={36} /><p>{note.entries?.filter(entry => entry.kind === 'file').length || 0} 个文件</p>{note.entries?.slice(0, 6).map(entry => <p key={entry.path}>{entry.path}</p>)}</div>
  if (note.kind === 'table') return <ReadTable columns={note.columns} rows={detail ? note.rows : note.rows?.slice(0, 8)} />
  if (note.kind === 'checklist') return <ul className="presentation-checklist">{note.items?.map(item => <li key={item.id}><span aria-label={item.done ? '已完成' : '未完成'}>{item.done ? '☑' : '☐'}</span><div><strong>{item.text}</strong>{(item.owner || item.dueDate || item.priority) && <small>{[item.owner, item.dueDate, item.priority ? { high: '高优先级', medium: '中优先级', low: '低优先级' }[item.priority] : ''].filter(Boolean).join(' · ')}</small>}</div></li>)}</ul>
  if (['program', 'code'].includes(note.kind)) return <>{note.body && <p>{note.body}</p>}{note.kind === 'program' && <p className="presentation-caption">可编程块 · {note.programApp?.enabled ? 'Flask 应用已配置 · ' : ''}{note.programDrivers?.length || 0} 个驱动 · {note.animation?.frames.length || 0} 个动画关键帧</p>}{(detail ? note.cells : note.cells?.slice(0, 1))?.map((cell, i) => <section className="presentation-code" key={cell.id}><h3>单元 {i + 1} · {cell.language}</h3><pre><code>{detail ? cell.code : cell.code.slice(0, 800)}</code></pre>{detail && <><h4>标准输入</h4><pre>{cell.stdin || '（空）'}</pre>{cell.expected !== undefined && <><h4>预期输出</h4><pre>{cell.expected}</pre></>}{cell.executedAt && <p>最近运行：{new Date(cell.executedAt).toLocaleString()} · 退出码 {cell.exitCode ?? '—'}{(cell.executedCode !== cell.code || cell.executedInput !== cell.stdin || cell.executedLanguage !== cell.language) ? ' · 结果来自先前版本' : ''}</p>}</>}{cell.output !== undefined && <><h4>已保存输出</h4><pre>{cell.output}</pre></>}{detail && cell.error && <><h4>错误输出</h4><pre>{cell.error}</pre></>}</section>)}</>
  if (note.kind === 'analysis') return detail ? <AnalysisReading note={note} /> : <pre>{note.analysisSource?.slice(0, 900)}</pre>
  if (note.kind === 'concept') return <><p>状态：{note.concept?.status}</p><RichPreview note={{ ...note, kind: 'markdown' }} />{detail && <>{[['验收标准', note.concept?.acceptance], ['最近进展', note.concept?.progress], ['产物与验证', note.concept?.evidence], ['下一步', note.concept?.nextAction], ['阻塞', note.concept?.blockers?.join('\n')]].map(([title, body]) => body && <section key={title}><h3>{title}</h3><RichPreview note={{ ...note, kind: 'markdown', body }} /></section>)}<h3>执行记录</h3>{note.concept?.history?.map((event, i) => <p key={i}>{new Date(event.at).toLocaleString()} · {event.text}</p>)}</>}</>
  if (note.kind === 'link') return <><p className="presentation-prose">{note.body}</p>{detail ? <a data-presentation-ui href={/^https?:\/\//.test(note.url || '') ? note.url : undefined} target="_blank" rel="noreferrer">{note.url}</a> : <p>{note.url}</p>}</>
  return <p className="presentation-prose">{note.body}</p>
}

export function Presentation({ initial, appearance, onClose }: { initial: PresentationSession; appearance: Appearance; onClose: () => void }) {
  const [session, setSession] = useState(initial), [view, setView] = useState<Viewport>({ x: 0, y: 0, zoom: 1 })
  const [detail, setDetail] = useState<CanvasNote | null>(null), [selected, setSelected] = useState<string>(), [error, setError] = useState('')
  const stage = useRef<HTMLDivElement>(null), views = useRef(new Map<string, Viewport>()), viewRef = useRef(view), closeBusy = useRef(false)
  const drag = useRef<{ pointerId: number; x: number; y: number; view: Viewport; note?: CanvasNote; moved: boolean } | null>(null)
  const board = session.boards.find(board => board.id === session.boardId)!
  viewRef.current = view
  const trail = boardTrail(session.boards, board.id)
  const fit = () => { if (stage.current) setView(presentationFit(board, stage.current.clientWidth, stage.current.clientHeight)) }
  async function close() {
    if (closeBusy.current) return
    closeBusy.current = true
    try { await setPresentationFullscreen(false); onClose() }
    catch (error) { setError((error as Error).message) }
    finally { closeBusy.current = false }
  }
  function navigate(id: string) {
    if (!session.boards.some(board => board.id === id && !board.trashed)) return
    views.current.set(board.id, view)
    setSession(current => ({ ...current, boardId: id })); setDetail(null); setSelected(undefined)
  }
  function open(note: CanvasNote) { if (note.kind === 'board' && note.childBoardId) navigate(note.childBoardId); else setDetail(note) }
  function zoom(value: number, point?: { x: number; y: number }) {
    const current = viewRef.current, next = Math.max(.05, Math.min(3, value)), rect = stage.current!.getBoundingClientRect()
    const cx = point?.x ?? rect.width / 2, cy = point?.y ?? rect.height / 2
    setView({ zoom: next, x: cx - (cx - current.x) * next / current.zoom, y: cy - (cy - current.y) * next / current.zoom })
  }
  useEffect(() => {
    const element = stage.current!
    setView(views.current.get(board.id) || presentationFit(board, element.clientWidth, element.clientHeight))
    const observer = new ResizeObserver(() => {
      // Keep the current zoom when resizing; a fit is always available on the toolbar.
      if (!views.current.has(board.id)) setView(presentationFit(board, element.clientWidth, element.clientHeight))
    })
    observer.observe(element)
    return () => observer.disconnect()
    // Positions change only within this presentation, not when changing the active board.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.id])
  useEffect(() => {
    const element = stage.current!
    const wheel = (event: WheelEvent) => {
      if ((event.target as Element).closest('[data-presentation-ui]')) return
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) { const rect = element.getBoundingClientRect(); zoom(viewRef.current.zoom * Math.exp(-event.deltaY * .004), { x: event.clientX - rect.left, y: event.clientY - rect.top }) }
      else setView(current => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }))
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (detail) setDetail(null); else void close(); return }
      if (event.key === 'Tab') {
        const container = detail ? document.querySelector('.presentation-detail, .file-library') : stage.current?.parentElement
        const controls = Array.from(container?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,select,[tabindex="0"]') || []).filter(element => element.getClientRects().length)
        const index = controls.indexOf(document.activeElement as HTMLElement), next = event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index + 1) % controls.length
        event.preventDefault(); controls[next]?.focus(); return
      }
      if (event.target instanceof Element && event.target.closest('button,a,input,select,textarea,video,audio')) return
      if ((event.ctrlKey || event.metaKey) && ['z', 'y', 's', 'd', 'v', 'x'].includes(event.key.toLowerCase())) { event.preventDefault(); return }
      if (detail) return
      if (event.key === '0') fit()
      if (event.key === '+' || event.key === '=') zoom(view.zoom * 1.2)
      if (event.key === '-') zoom(view.zoom / 1.2)
      if (event.key === 'Enter' && selected) { const note = board.notes.find(note => note.id === selected); if (note) open(note) }
    }
    const fullscreen = () => { if (!window.ownDesktop && !document.fullscreenElement) onClose() }
    document.addEventListener('keydown', key)
    document.addEventListener('fullscreenchange', fullscreen)
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('fullscreenchange', fullscreen) }
  })
  useEffect(() => { if (detail) requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.presentation-detail button, .file-library-header button[aria-label]')?.focus()); else stage.current?.focus() }, [detail])
  function begin(event: ReactPointerEvent, note?: CanvasNote) {
    if (event.button !== 0 || (event.target as Element).closest('[data-presentation-ui],button,a,input,select')) return
    event.preventDefault(); event.stopPropagation()
    if (note) setSelected(note.id); else setSelected(undefined)
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, view, note, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function move(event: ReactPointerEvent) {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    const dx = event.clientX - current.x, dy = event.clientY - current.y
    if (!current.moved && Math.hypot(dx, dy) < 4) return
    current.moved = true
    if (current.note) setSession(session => movePresentationNote(session, board.id, current.note!.id, current.note!.x + dx / current.view.zoom, current.note!.y + dy / current.view.zoom))
    else setView({ ...current.view, x: current.view.x + dx, y: current.view.y + dy })
  }
  return <section className="presentation" style={themeVariables(appearance) as CSSProperties} aria-label="演讲模式" onPaste={event => event.preventDefault()} onDrop={event => event.preventDefault()} onDragOver={event => event.preventDefault()} onContextMenu={event => event.preventDefault()}>
    <header className="presentation-toolbar" inert={!!detail} data-presentation-ui><div className="presentation-heading"><span className="presentation-live">演讲</span><nav aria-label="演讲画布路径">{trail.map((ancestor, i) => <span key={ancestor.id}>{i > 0 && <ChevronRight size={13} />}<button disabled={ancestor.id === board.id || ancestor.trashed} onClick={() => navigate(ancestor.id)}>{ancestor.title}</button></span>)}</nav></div><div className="presentation-tools"><button title="缩小 (-)" aria-label="演讲缩小" onClick={() => zoom(view.zoom / 1.2)}><Minus size={16} /></button><span>{Math.round(view.zoom * 100)}%</span><button title="放大 (+)" aria-label="演讲放大" onClick={() => zoom(view.zoom * 1.2)}><Plus size={16} /></button><button onClick={fit}><Expand size={15} />适应画布</button><button onClick={() => { views.current.clear(); setSession({ ...structuredClone(initial), boardId: board.id }); requestAnimationFrame(() => { const original = initial.boards.find(b => b.id === board.id)!; if (stage.current) setView(presentationFit(original, stage.current.clientWidth, stage.current.clientHeight)) }) }}><RotateCcw size={15} />重置布局</button><button className="presentation-exit" onClick={() => void close()}><X size={16} />退出演讲</button></div></header>
    <div ref={stage} className="presentation-stage" tabIndex={0} aria-label="演讲画布，拖动内容调整临时位置，双击查看详情" inert={!!detail} onPointerDown={event => begin(event)} onPointerMove={move} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}>
      <div className="presentation-pan" style={{ left: view.x, top: view.y }}><div className="presentation-world" style={{ zoom: view.zoom }}>
        <svg className="presentation-connections" aria-hidden="true"><defs><marker id="presentation-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" /></marker></defs>{board.connections.map(edge => {
          const from = board.notes.find(note => note.id === edge.from), to = board.notes.find(note => note.id === edge.to)
          if (!from || !to) return null
          const geometry = connectionGeometry(from, to, edge)
          return <g key={edge.id}><path d={geometry.path} stroke={edge.color || appearance.accent} strokeWidth={2} fill="none" strokeDasharray={edge.dashed ? '7 5' : undefined} markerEnd={edge.arrow === 'none' ? undefined : 'url(#presentation-arrow)'} markerStart={edge.arrow === 'both' ? 'url(#presentation-arrow)' : undefined} />{edge.label && <text x={geometry.label.x} y={geometry.label.y - 8} textAnchor="middle">{edge.label}</text>}</g>
        })}</svg>
        {board.notes.map(note => <article key={note.id} tabIndex={0} data-presentation-note={note.id} aria-label={`展示内容：${note.title || note.filename || '笔记'}`} className={`presentation-card presentation-kind-${note.kind} ${selected === note.id ? 'presentation-selected' : ''}`} style={{ left: note.x, top: note.y, width: note.width, height: note.height, ...cardVariables(note.color || (note.kind === 'sticky' ? '#fff5d9' : '#ffffff'), appearance.accent) } as CSSProperties} onPointerDown={event => begin(event, note)} onDoubleClick={event => { event.stopPropagation(); if (!(event.target as Element).closest('button,a')) open(note) }} onFocus={() => setSelected(note.id)} onKeyDown={event => { if (event.key === 'Enter') { event.stopPropagation(); open(note) } }}>
          {note.kind === 'board' ? <CanvasPortal board={session.boards.find(board => board.id === note.childBoardId)} onOpen={() => open(note)} /> : <><header><span>{note.label || ({ program: '可编程块', code: '兼容代码块', analysis: '数据分析', folder: '文件夹', file: '附件', latex: 'LaTeX', diagram: 'Mermaid' } as Record<string, string>)[note.kind] || 'OWN'}</span><Expand size={13} /></header><h2>{note.title || note.filename}</h2><div className="presentation-card-content"><NoteReading note={note} /></div></>}
        </article>)}
      </div></div>
      {!board.notes.length && <div className="presentation-empty"><LayoutGrid size={48} /><h2>{board.title}</h2><p>此画布暂无内容。退出演讲后可添加笔记。</p></div>}
    </div>
    <footer className="presentation-hint" inert={!!detail}>{trail.length > 1 && <button data-presentation-ui onClick={() => navigate(trail[trail.length - 2].id)}><ArrowLeft size={14} />返回上级</button>}<span>拖动临时调整 · 双击查看详情 · Ctrl + 滚轮缩放 · Esc 返回</span><strong>只读展示 · 布局不保存</strong></footer>
    {error && <p className="presentation-error" role="alert">{error}</p>}
    {detail && (detail.kind === 'folder' ? <FileLibrary note={detail} readOnly onClose={() => setDetail(null)} /> : <div className="presentation-detail-backdrop" onClick={event => { if (event.target === event.currentTarget) setDetail(null) }}><section className="presentation-detail" role="dialog" aria-modal="true" aria-label={`展示详情：${detail.title || detail.filename}`}><header><div><span>只读详情</span><h2>{detail.title || detail.filename}</h2></div><button aria-label="关闭展示详情" onClick={() => setDetail(null)}><X size={22} /></button></header><div className="presentation-detail-body"><NoteReading note={detail} detail /></div><footer>Esc 返回画布 · 演讲模式无法编辑内容</footer></section></div>)}
  </section>
}
