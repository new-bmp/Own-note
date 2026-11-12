import { useEffect, useRef, useState } from 'react'
import { BookOpen, Download, X } from 'lucide-react'
import type { Board, CanvasNote } from './model'
import { RichPreview, SourceBadge, isRichNote } from './RichContent'
import { downloadFile } from './storage'

function ReadableNote({ note }: { note: CanvasNote }) {
  if (isRichNote(note)) return <RichPreview note={note} />
  if (note.kind === 'checklist') return (
    <ul className="reader-tasks">
      {note.items?.map((item) => (
        <li key={item.id}>
          <input type="checkbox" checked={item.done} disabled aria-label={item.done ? '已完成' : '待完成'} />
          <div>
            <span className={item.done ? 'reader-task-done' : ''}>{item.text}</span>
            {(item.owner || item.dueDate || item.priority) && <small>
              {[
                item.owner && `负责人 ${item.owner}`,
                item.dueDate && `截止 ${item.dueDate}`,
                item.priority && `${{ high: '高', medium: '中', low: '低' }[item.priority]}优先级`,
              ].filter(Boolean).join(' · ')}
            </small>}
          </div>
        </li>
      ))}
    </ul>
  )
  if (note.kind === 'table') return (
    <div className="reader-table rich-markdown"><table>
      <thead><tr>{note.columns?.map((column, index) => <th key={index}>{column}</th>)}</tr></thead>
      <tbody>{note.rows?.map((row, index) => <tr key={index}>{row.map((cell, index) => <td key={index}>{cell}</td>)}</tr>)}</tbody>
    </table></div>
  )
  return <p className="reader-plain">{note.body || note.url || note.filename || ''}</p>
}

export function ConversationReader({ board, noteId, onClose }: {
  board: Board
  noteId: string
  onClose: () => void
}) {
  const capture = board.captures?.find((capture) => capture.noteIds.includes(noteId))
  const byId = new Map(board.notes.map((note) => [note.id, note]))
  const ids = capture?.noteIds || [noteId]
  const notes = ids.flatMap((id) => byId.has(id) ? [byId.get(id)!] : [])
  const [current, setCurrent] = useState(noteId)
  const sections = useRef(new Map<string, HTMLElement>())
  const content = useRef<HTMLDivElement>(null)
  const title = capture?.title || notes[0]?.title || '阅读全文'
  const missing = ids.length - notes.length
  const original = capture?.content?.markdown
  const originalChanged = original !== undefined &&
    capture?.content?.markdownNoteIds?.map((id) => byId.get(id)?.body || '').join('') !== original
  const actionCount = notes.reduce((sum, note) => sum + (note.items?.length || 0), 0)

  function jump(id: string) {
    setCurrent(id)
    const section = sections.current.get(id)
    if (section && content.current) content.current.scrollTop = section.offsetTop - 24
  }
  useEffect(() => { jump(noteId) }, [noteId])

  return (
    <div className="modal-overlay conversation-reader-overlay" onClick={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="conversation-reader" role="dialog" aria-modal="true" aria-label={`阅读：${title}`}>
        <header className="reader-header">
          <BookOpen size={21} />
          <div><span>{capture ? '会话阅读' : '笔记阅读'}</span><h2>{title}</h2></div>
          {original !== undefined && <button className="reader-export" title="导出最初提交的正文；额外行动项和图在下方阅读。" onClick={() => downloadFile(
            new Blob([original], { type: 'text/markdown;charset=utf-8' }), `${title}-正文原稿.md`,
          )}><Download size={15} /><span>导出正文原稿</span></button>}
          <button className="reader-close" aria-label="关闭阅读" title="关闭阅读 (Esc)" onClick={onClose}><X size={21} /></button>
        </header>
        <div className="reader-layout">
          <nav className="reader-outline" aria-label="会话目录">
            <p>{notes.length} 节内容{actionCount ? ` · ${actionCount} 项行动` : ''}</p>
            {notes.map((note, index) => <button key={note.id} aria-current={current === note.id ? 'location' : undefined} onClick={() => jump(note.id)}>
              <span>{String(index + 1).padStart(2, '0')}</span><span>{note.title || note.label || '笔记'}</span>
            </button>)}
          </nav>
          <div className="reader-content" ref={content} tabIndex={0} aria-label="会话正文">
            {missing > 0 && <p className="reader-notice">有 {missing} 节内容已从画布删除，以下为当前保留的记录。</p>}
            {originalChanged && <p className="reader-notice">正文已被编辑。这里展示当前内容，导出的是保存时的正文原稿。</p>}
            {notes.map((note, index) => <article className="reader-section" key={note.id} ref={(element) => {
              if (element) sections.current.set(note.id, element)
              else sections.current.delete(note.id)
            }}>
              <div className="reader-section-label">{String(index + 1).padStart(2, '0')}<span>{note.label || '会话内容'}</span></div>
              {!(note.kind === 'markdown' && /^\s*#{1,6}\s/.test(note.body || '')) && <h2>{note.title}</h2>}
              <ReadableNote note={note} />
              {note.caption && <p className="rich-caption">{note.caption}</p>}
              {index === 0 && <SourceBadge note={note} />}
            </article>)}
            <p className="reader-end">已读至末尾 · 共 {notes.length} 节内容</p>
          </div>
        </div>
      </section>
    </div>
  )
}
