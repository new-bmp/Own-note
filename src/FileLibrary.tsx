import { lazy, Suspense, useEffect, useState } from 'react'
import { ChevronRight, Download, FileText, FolderOpen, Search, X, ArrowUp, ExternalLink, Plus } from 'lucide-react'
import type { CanvasNote, FolderEntry } from './model'
import { getAsset, downloadFile } from './storage'
import { RichPreview } from './RichContent'
import { extension, inferMime, previewType, validEntryPath } from '../shared/attachments.js'
import { openNativeAsset } from './desktop'
import type { DocumentPart } from './office-preview'
const MediaPlayer = lazy(()=>import('./MediaPlayer').then(m=>({default:m.MediaPlayer})))
const ModelViewer = lazy(()=>import('./ModelViewer').then(m=>({default:m.ModelViewer})))
const noEntries: FolderEntry[] = []

const size = (value = 0) => value >= 1048576 ? `${(value / 1048576).toFixed(1)} MB` : `${(value / 1024).toFixed(1)} KB`
export function entryNote(folder: CanvasNote, entry: FolderEntry): CanvasNote {
  return { ...folder, kind: 'file', title: entry.path.split('/').at(-1), filename: entry.path.split('/').at(-1),
    assetId: entry.assetId, size: entry.size, mime: entry.mime, entries: folder.entries, modelPath: entry.path }
}

function FileContent({ note }: { note: CanvasNote }) {
  const [data, setData] = useState<{ blob?: Blob; url?: string; text?: string; parts?: DocumentPart[]; error?: string; clipped?: boolean }>({})
  const [raw, setRaw] = useState(false)
  const filename = note.filename || note.title || '附件'
  const type = previewType(filename, note.mime)
  const ext = extension(filename)
  useEffect(() => {
    let active = true, url = ''
    setData({})
    setRaw(false)
    void (async () => {
      try {
        const blob = note.assetId ? await getAsset(note.assetId) : note.src ? await fetch(note.src).then((response) => {
          if (!response.ok) throw new Error('附件暂时无法读取。')
          return response.blob()
        }) : undefined
        if (!blob) throw new Error('找不到附件，请检查工作空间中的附件文件。')
        const mime = inferMime(filename, note.mime || blob.type)
        url = URL.createObjectURL(blob.slice(0, blob.size, mime))
        if (active) setData({ blob, url })
        if (type === 'text') {
          const bytes = new Uint8Array(await blob.slice(0, 1_000_000).arrayBuffer())
          let text = new TextDecoder('utf-8').decode(bytes, { stream: blob.size > bytes.length })
          if (text.includes('\ufffd')) text = new TextDecoder('gb18030').decode(bytes)
          if (active) setData({ blob, url, text, clipped: blob.size > bytes.length })
        } else if (type === 'office') {
          if (blob.size > 50_000_000) throw new Error('文件较大，请另存后使用桌面软件打开。')
          const { readOffice } = await import('./office-preview')
          const parts = readOffice(new Uint8Array(await blob.arrayBuffer()), ext)
          if (active) setData({ blob, url, parts })
        } else if (active) setData({ blob, url })
      } catch (error) { if (active) setData((data) => ({ ...data, error: error instanceof Error ? error.message : '预览暂时无法显示，原始文件仍保留。' })) }
      finally { if (!active && url) URL.revokeObjectURL(url) }
    })()
    return () => { active = false; if (url) URL.revokeObjectURL(url) }
  }, [note.assetId, note.src, filename, note.mime, type, ext])
  const rich = ['md', 'markdown', 'tex', 'mmd', 'mermaid'].includes(ext)
  return (
    <div className="file-detail">
      <header className="file-detail-header"><div><strong>{filename}</strong><small>{size(note.size)} · {inferMime(filename, note.mime)}</small></div>
        {data.blob && <button className="secondary-button" onClick={() => downloadFile(data.blob!, filename)}><Download size={14} />另存为</button>}
        {window.ownDesktop && note.assetId && <button className="secondary-button" onClick={() => void openNativeAsset(note.assetId!, filename).catch((error) => setData((data) => ({ ...data, error: error.message })))}><ExternalLink size={14} />用系统应用打开</button>}
      </header>
      {data.error && <p className="file-preview-notice" role="alert">{data.error}</p>}
      {!data.blob && !data.error && <p className="file-preview-notice" role="status">正在读取文件…</p>}
      {data.clipped && <p className="file-preview-notice">当前预览前 1 MB，原始文件已完整保存，可另存为查看全部。</p>}
      {rich && data.text !== undefined && <div className="editor-mode-tabs"><button className={!raw ? 'active' : ''} onClick={() => setRaw(false)}>阅读预览</button><button className={raw ? 'active' : ''} onClick={() => setRaw(true)}>原始内容</button></div>}
      <div className="file-content-scroll" tabIndex={0}>
        {data.url && type === 'image' && <img className="file-preview-image" src={data.url} alt={filename} onError={() => setData((data) => ({ ...data, error: '当前环境无法预览此图片格式，请另存为或用系统应用打开。' }))} />}
        {data.url && type === 'pdf' && <iframe className="file-preview-pdf" src={data.url} title={filename} />}
        <Suspense fallback={<p role="status">正在加载查看器…</p>}>
          {data.url && (type === 'video' || type === 'audio') && <MediaPlayer url={data.url} kind={type} assetId={note.assetId} filename={filename} settings={note.mediaSettings}/>}
          {data.blob && type === 'model' && <ModelViewer blob={data.blob} filename={filename} entries={note.entries || noEntries} resourcePath={note.modelPath} settings={note.modelSettings}/>}
        </Suspense>
        {data.text !== undefined && (!rich || raw ? <pre className="file-text-content">{data.text}</pre> : <RichPreview note={{ ...note, kind: ext === 'tex' ? 'latex' : ['mmd', 'mermaid'].includes(ext) ? 'diagram' : 'markdown', body: data.text, latex: data.text, mermaid: data.text }} />)}
        {data.parts && <div className="office-preview"><p className="office-preview-hint">内容预览 · 原文排版、图片与图表请使用系统应用查看</p>{data.parts.map((part, index) => <section key={index}>
          {part.title && <h3>{part.title}</h3>}{part.text && <p>{part.text}</p>}
          {part.rows && <div className="office-table"><table><tbody>{part.rows.map((row, index) => <tr key={index}>{row.map((cell, index) => <td key={index}>{cell}</td>)}</tr>)}</tbody></table></div>}
        </section>)}</div>}
        {type === 'binary' && data.blob && <div className="file-no-preview"><FileText size={44} /><h3>{filename}</h3><p>文件已完整保存在笔记中。</p><p>此格式可另存为，或用系统应用打开。</p></div>}
      </div>
    </div>
  )
}

export function FolderCard({ note, onOpen }: { note: CanvasNote; onOpen: () => void }) {
  const entries = note.entries || []
  return <div className="folder-card"><div className="folder-card-title"><FolderOpen size={27} /><div><h3>{note.title}</h3><small>{entries.filter((entry) => entry.kind === 'file').length} 个文件 · {size(note.size)}</small></div></div>
    <div className="folder-card-entries">{entries.filter((entry) => !entry.path.includes('/')).slice(0, 4).map((entry) => <div key={entry.path}>{entry.kind === 'directory' ? <FolderOpen size={14} /> : <FileText size={14} />}<span>{entry.path}</span>{entry.error && <span>未导入</span>}</div>)}{!entries.length && <p>空文件夹</p>}</div>
    <button className="folder-open-button" onClick={onOpen} data-canvas-ui><FolderOpen size={14} />浏览文件夹<ChevronRight size={14} /></button>
  </div>
}

export function FileLibrary({ note, onClose, onExtract }: { note: CanvasNote; onClose: () => void; onExtract: (note: CanvasNote) => void }) {
  const [directory, setDirectory] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<FolderEntry | null>(()=>note.entries?.find(e=>e.path===note.modelPath&&e.kind==='file')||null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const entries = note.entries || []
  const visible = entries.filter((entry) => query ? entry.path.toLowerCase().includes(query.toLowerCase()) : entry.path.split('/').slice(0, -1).join('/') === directory)
    .sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.path.localeCompare(b.path, 'zh-CN', { numeric: true }))
  const current = note.kind !== 'folder' ? note : selected?.assetId ? entryNote(note, selected) : null
  async function downloadFolder() {
    setBusy(true); setMessage('')
    try {
      const { zipSync } = await import('fflate')
      const files: Record<string, Uint8Array> = Object.create(null)
      let bytes = 0
      for (const entry of entries) {
        if (!validEntryPath(entry.path)) throw new Error('目录中包含无法导出的路径。')
        if (entry.error) throw new Error(`${entry.path} 尚未成功导入，无法导出完整文件夹。`)
        if (entry.kind === 'directory') files[entry.path + '/'] = new Uint8Array()
        else {
          const blob = entry.assetId ? await getAsset(entry.assetId) : undefined
          if (!blob) throw new Error(`无法读取 ${entry.path}`)
          bytes += blob.size
          if (bytes > 250_000_000) throw new Error('文件夹较大，请使用完整备份导出，或逐个另存文件。')
          files[entry.path] = new Uint8Array(await blob.arrayBuffer())
        }
      }
      const zipped = zipSync(files, { level: 0 })
      downloadFile(new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), `${note.title || '文件夹'}.zip`)
    } catch (error) { setMessage(error instanceof Error ? error.message : '导出未完成。') }
    finally { setBusy(false) }
  }
  return <div className="modal-overlay file-library-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="file-library" role="dialog" aria-modal="true" aria-label={`浏览${note.title || note.filename}`}>
      <header className="file-library-header">{note.kind === 'folder' ? <FolderOpen size={21} /> : <FileText size={21} />}<div><h2>{note.title || note.filename}</h2><small>{note.kind === 'folder' ? '已复制到笔记 · 文件夹内容可独立浏览' : '笔记附件'}</small></div>
        {note.kind === 'folder' && <button className="secondary-button" disabled={busy} onClick={() => void downloadFolder()}><Download size={14} />{busy ? '正在整理…' : '导出文件夹'}</button>}
        <button aria-label="关闭文件浏览" className="icon-button" onClick={onClose}><X size={21} /></button>
      </header>
      {message && <p className="file-preview-notice" role="alert">{message}</p>}
      <div className={`file-library-body ${note.kind !== 'folder' ? 'single-file' : ''}`}>
        {note.kind === 'folder' && <aside className="folder-browser"><label className="folder-search"><Search size={15} /><input aria-label="搜索文件夹内容" placeholder="搜索文件名或路径…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <div className="folder-breadcrumb"><button aria-label="返回上级文件夹" disabled={!directory} onClick={() => { setDirectory(directory.split('/').slice(0, -1).join('/')); setQuery('') }}><ArrowUp size={14} /></button><button onClick={() => { setDirectory(''); setQuery('') }} title="回到根目录">{note.title}</button>{directory && <span title={directory}>/ {directory}</span>}</div>
          <div className="folder-entry-list">{visible.map((entry) => <button key={entry.path} className={selected?.path === entry.path ? 'selected' : ''} title={entry.error || entry.path} onClick={() => {
            if (entry.kind === 'directory') { setDirectory(entry.path); setQuery('') } else setSelected(entry)
          }}>{entry.kind === 'directory' ? <FolderOpen size={17} /> : <FileText size={17} />}<span><strong>{query ? entry.path : entry.path.split('/').at(-1)}</strong><small>{entry.error ? '未导入 · 点击查看原因' : entry.kind === 'directory' ? '文件夹' : size(entry.size)}</small></span>{entry.kind === 'directory' && <ChevronRight size={14} />}</button>)}{!visible.length && <p className="file-preview-notice">{query ? '没有匹配的文件。' : '此文件夹为空。'}</p>}</div>
          <footer>{entries.filter((entry) => entry.kind === 'file' && entry.assetId).length} 个文件已保存在笔记中</footer>
        </aside>}
        <main className="file-library-main">{current ? <FileContent key={current.assetId || current.src} note={current} /> : <div className="file-no-preview"><FolderOpen size={44} /><h3>{selected?.error ? '这个文件未能导入' : '选择文件查看内容'}</h3><p>{selected?.error || '支持图片、PDF、音视频、文本、代码，以及 Word、Excel、PowerPoint 内容预览。'}</p></div>}
          {current && note.kind === 'folder' && <div className="folder-extract"><button className="secondary-button" onClick={() => onExtract(current)}><Plus size={14} />将此文件放到画布</button></div>}
        </main>
      </div>
    </section>
  </div>
}
