import { ArrowUpRight, LayoutGrid } from 'lucide-react'
import type { Board } from './model'

export function CanvasPortal({ board, onOpen }: { board?: Board; onOpen: () => void }) {
  const notes = board?.notes || []
  const left = Math.min(0, ...notes.map(note => note.x)), top = Math.min(0, ...notes.map(note => note.y))
  const width = Math.max(400, ...notes.map(note => note.x + note.width)) - left
  const height = Math.max(250, ...notes.map(note => note.y + note.height)) - top
  return <div className="canvas-portal">
    <header><LayoutGrid size={17} /><span>子画布 · 共享存储</span><small>{notes.length} 个内容块</small></header>
    <h3>{board?.title || '子画布暂不可用'}</h3>
    <div className="canvas-portal-preview" aria-hidden="true">{notes.slice(0, 80).map(note => <span key={note.id} style={{ left: `${(note.x - left) / width * 100}%`, top: `${(note.y - top) / height * 100}%`, width: `${note.width / width * 100}%`, height: `${note.height / height * 100}%`, background: note.color || '#f2f4ff' }}><b>{note.title || note.filename || note.body}</b></span>)}{!notes.length && <p>在这里展开更多内容</p>}</div>
    <button data-canvas-ui className="canvas-portal-open" disabled={!board || board.trashed} onClick={onOpen}>{board?.trashed ? '已在回收站' : '进入子画布'}<ArrowUpRight size={16} /></button>
  </div>
}
