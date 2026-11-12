import { initialNotebook, upgradeWorkspace } from './model'
import type { Notebook } from './model'
import { validNotebook } from '../shared/validation.js'
import { assetIdsForNote } from '../shared/attachments.js'
export { validNotebook } from '../shared/validation.js'

const STORAGE_KEY = 'fieldnotes:notebook:v1'
const REVISION_KEY = 'fieldnotes:server-revision'
const DIRTY_KEY = 'fieldnotes:unsaved'
const RECOVERY_KEY = 'fieldnotes:recovery'
let database: Promise<IDBDatabase> | undefined
let serverRevision: string | null = null
let saveQueue: Promise<void> = Promise.resolve()
let savedSnapshot: string | null = null
let pendingWrites = 0

export class WorkspaceConflictError extends Error {}

function readCache(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function setCache(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* The server remains the primary store. */
  }
}
function removeCache(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    /* The server remains the primary store. */
  }
}

function cacheNotebook(notebook: Notebook) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notebook))
    localStorage.setItem(DIRTY_KEY, '1')
  } catch {
    removeCache(DIRTY_KEY)
    /* A stale cache must never be replayed over a successful server save. */
  }
}

export function readRecoveryNotebook(): Notebook | undefined {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(RECOVERY_KEY) || 'null',
    )
    if (validNotebook(value)) return value
  } catch {
    /* No usable recovery copy. */
  }
}

export function clearRecoveryNotebook() {
  removeCache(RECOVERY_KEY)
}

export function serverConnected() {
  return serverRevision !== null
}

async function uploadAsset(id: string, blob: Blob) {
  const response = await fetch(`/api/assets/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
    signal: AbortSignal.timeout(120_000),
  })
  if (!response.ok) throw new Error('附件未能保存到本地服务。')
}

async function migrateAssets(notebook: Notebook) {
  const ids = new Set(
    notebook.boards.flatMap((board) =>
      board.notes.flatMap(assetIdsForNote),
    ),
  )
  for (const id of ids) {
    const exists = await fetch(`/api/assets/${encodeURIComponent(id)}`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(15_000),
    })
    if (exists.ok) continue
    if (exists.status !== 404) throw new Error('无法检查已有附件。')
    const blob = await getCachedAsset(id)
    if (!blob) throw new Error('缺少原始附件，无法完整恢复，请保留原工作空间。')
    await uploadAsset(id, blob)
  }
}

export const restoreRecoveryAssets = migrateAssets

async function saveToServer(notebook: Notebook, keepalive = false) {
  if (serverRevision === null) {
    const current = await fetch('/api/notebook', {
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    })
    if (!current.ok || !current.headers.get('ETag'))
      throw new Error('本地服务尚未连接，请重试保存或导出备份。')
    const { notebook: remote }: { notebook: unknown } = await current.json()
    if (remote !== null && !validNotebook(remote))
      throw new Error('本地工作空间暂时无法读取。')
    const etag = current.headers.get('ETag')!
    if (
      remote !== null &&
      etag !== readCache(REVISION_KEY) &&
      JSON.stringify(remote) !== JSON.stringify(notebook)
    )
      throw new WorkspaceConflictError(
        '另一个窗口已保存更新，请先导出当前内容，再刷新页面。',
      )
    if (remote === null) await migrateAssets(notebook)
    serverRevision = etag
  }
  const response = await fetch('/api/notebook', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'If-Match': serverRevision },
    body: JSON.stringify(notebook),
    keepalive,
    signal: keepalive ? undefined : AbortSignal.timeout(15_000),
  })
  if (response.status === 409)
    throw new WorkspaceConflictError(
      '另一个窗口已保存更新，请先导出当前内容，再刷新页面。',
    )
  if (!response.ok) throw new Error('本地服务保存失败，请重试或导出备份。')
  serverRevision = response.headers.get('ETag')
  savedSnapshot = JSON.stringify(notebook)
  try {
    localStorage.setItem(REVISION_KEY, serverRevision || '')
    if (localStorage.getItem(STORAGE_KEY) === JSON.stringify(notebook))
      localStorage.removeItem(DIRTY_KEY)
  } catch {
    /* The server already confirmed the durable save. */
  }
}

export async function loadNotebook(): Promise<Notebook> {
  const cached = readNotebook()
  try {
    const response = await fetch('/api/notebook', {
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok || !response.headers.get('ETag')) return cached
    const { notebook }: { notebook: unknown } = await response.json()
    if (notebook !== null && !validNotebook(notebook)) return cached
    serverRevision = response.headers.get('ETag')
    if (notebook === null) {
      await migrateAssets(cached)
      cacheNotebook(cached)
      await saveToServer(cached)
      return cached
    }
    const dirty = readCache(DIRTY_KEY) === '1'
    if (dirty && readCache(REVISION_KEY) === serverRevision) {
      await migrateAssets(cached)
      await saveToServer(cached)
      return cached
    }
    if (dirty && JSON.stringify(cached) !== JSON.stringify(notebook))
      setCache(RECOVERY_KEY, JSON.stringify(cached))
    const current = upgradeWorkspace(notebook)
    savedSnapshot = JSON.stringify(current)
    setCache(STORAGE_KEY, JSON.stringify(current))
    setCache(REVISION_KEY, serverRevision || '')
    removeCache(DIRTY_KEY)
    return current
  } catch {
    serverRevision = null
    return cached
  }
}

export function readNotebook(): Notebook {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || 'null',
    )
    if (validNotebook(stored) && stored.boards.some((b) => !b.trashed))
      return upgradeWorkspace({
        ...stored,
        activeBoardId:
          stored.boards.find((b) => b.id === stored.activeBoardId && !b.trashed)
            ?.id ?? stored.boards.find((b) => !b.trashed)!.id,
      })
  } catch {
    /* An unavailable or older local store starts a fresh notebook. */
  }
  return initialNotebook()
}

export function writeNotebook(
  notebook: Notebook,
  keepalive = false,
): Promise<void> {
  if (JSON.stringify(notebook) === savedSnapshot && !pendingWrites)
    return Promise.resolve()
  cacheNotebook(notebook)
  pendingWrites++
  const pending = saveQueue
    .then(() => saveToServer(notebook, keepalive))
    .finally(() => {
      pendingWrites--
    })
  saveQueue = pending.catch(() => {})
  return pending
}

export async function refreshNotebook(
  current: Notebook,
  stillIdle: () => boolean,
  force = false,
): Promise<Notebook | null> {
  if (pendingWrites || (!force && JSON.stringify(current) !== savedSnapshot))
    return null
  const previousRevision = serverRevision
  const response = await fetch('/api/notebook', {
    cache: 'no-store',
    headers:
      !force && serverRevision ? { 'If-None-Match': serverRevision } : {},
    signal: AbortSignal.timeout(8000),
  })
  if (response.status === 304) return null
  if (!response.ok) throw new Error('暂时无法接收工作空间更新。')
  const { notebook: remote }: { notebook: unknown } = await response.json()
  if (!validNotebook(remote) || !response.headers.get('ETag')) return null
  if (pendingWrites || serverRevision !== previousRevision || !stillIdle())
    return null
  if (force && JSON.stringify(current) !== savedSnapshot)
    setCache(RECOVERY_KEY, JSON.stringify(current))
  const notebook = upgradeWorkspace(remote)
  if (
    notebook.boards.some(
      (board) => board.id === current.activeBoardId && !board.trashed,
    )
  )
    notebook.activeBoardId = current.activeBoardId
  serverRevision = response.headers.get('ETag')
  savedSnapshot = JSON.stringify(notebook)
  setCache(STORAGE_KEY, savedSnapshot)
  setCache(REVISION_KEY, serverRevision || '')
  removeCache(DIRTY_KEY)
  return notebook
}

function db() {
  if (!database)
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('fieldnotes-assets', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('assets')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => {
        database = undefined
        reject(request.error)
      }
    })
  return database
}

async function cacheAsset(id: string, blob: Blob) {
  const database = await db()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('assets', 'readwrite')
    transaction.objectStore('assets').put(blob, id)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

async function getCachedAsset(id: string): Promise<Blob | undefined> {
  const database = await db()
  return new Promise((resolve, reject) => {
    const request = database.transaction('assets').objectStore('assets').get(id)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function putAsset(id: string, blob: Blob) {
  await uploadAsset(id, blob)
  await cacheAsset(id, blob).catch(() => {})
}

export async function getAsset(id: string): Promise<Blob | undefined> {
  try {
    const response = await fetch(`/api/assets/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(15_000),
    })
    if (response.ok) return await response.blob()
  } catch {
    /* Previously cached attachments can still be viewed. */
  }
  return getCachedAsset(id)
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export function downloadFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
