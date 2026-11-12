import { makeNote, uid } from './model.ts'
import type { CanvasNote, FolderEntry } from './model'
import type { ImportGroup } from './file-import'
import { inferMime, validEntryPath } from '../shared/attachments.js'

export interface ImportProgress { done: number; total: number; name: string }
export async function importAssets(groups: ImportGroup[], point: { x: number; y: number },
  store: (id: string, blob: Blob) => Promise<void>, progress: (value: ImportProgress) => void) {
  const notes: CanvasNote[] = [], errors: string[] = []
  const total = groups.reduce((sum, group) => sum + group.entries.filter((entry) => entry.file).length, 0)
  let done = 0
  for (const [index, group] of groups.entries()) {
    const x = point.x + (index % 3) * 380, y = point.y + Math.floor(index / 3) * 500
    if (group.entries.length > 10000 || group.entries.some((entry) => !validEntryPath(entry.path))) {
      errors.push(`${group.name}：目录路径无效或条目超过 10000 个。`); continue
    }
    const entries: FolderEntry[] = []
    for (const entry of group.entries) {
      if (!entry.file) { entries.push({ path: entry.path, kind: 'directory' }); continue }
      const file = entry.file, assetId = uid(), mime = inferMime(file.name, file.type)
      progress({ done, total, name: group.folder ? `${group.name}/${entry.path}` : file.name })
      const record: FolderEntry = { path: entry.path, kind: 'file', size: file.size, mime, modifiedAt: file.lastModified }
      try {
        if (file.size > 100 * 1024 * 1024) throw new Error('单个文件超过 100 MB，请拆分后导入。')
        await store(assetId, file.slice(0, file.size, mime))
        record.assetId = assetId
      } catch (error) {
        record.error = (error instanceof Error ? error.message : '文件未能保存，请重试。').slice(0, 1000)
        errors.push(`${group.name}${group.folder ? '/' + entry.path : ''}：${record.error}`)
      }
      entries.push(record); done++
      progress({ done, total, name: entry.path })
    }
    if (group.folder) {
      notes.push({ ...makeNote('folder', x, y), title: group.name, entries, size: entries.reduce((sum, entry) => sum + (entry.assetId ? entry.size || 0 : 0), 0) })
    } else {
      const entry = entries.find((entry) => entry.assetId)
      if (!entry) continue
      const image = entry.mime?.startsWith('image/')
      const note: CanvasNote = { ...makeNote(image ? 'image' : 'file', x, y), title: group.name, filename: group.name, assetId: entry.assetId, mime: entry.mime, size: entry.size, label: '项目附件' }
      if (image && typeof createImageBitmap === 'function') {
        try {
          const bitmap = await createImageBitmap(group.entries[0].file!)
          note.height = Math.min(460, Math.max(180, 330 * bitmap.height / bitmap.width + 60))
          bitmap.close()
        } catch { /* The image preview can still use formats unsupported by ImageBitmap. */ }
      }
      notes.push(note)
    }
  }
  return { notes, errors }
}
