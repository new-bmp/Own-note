import { constants } from 'node:fs'
import { cp, mkdir, open, readFile, readdir, rename, rm, rmdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { createFieldnotesServer, workspaceIdentity } from '../server.mjs'
import { validNotebook } from '../shared/validation.js'

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

async function exists(filename) {
  try { await stat(filename); return true }
  catch (error) { if (error.code === 'ENOENT') return false; throw error }
}

// Import only into an empty desktop workspace. The original files remain a backup.
export async function prepareWorkspace(dataDir, legacyDir) {
  dataDir = path.resolve(dataDir)
  if (!legacyDir || path.resolve(legacyDir) === dataDir ||
      await exists(path.join(dataDir, 'notebook.json')) ||
      !await exists(path.join(legacyDir, 'notebook.json'))) return false
  const notebook = JSON.parse(await readFile(path.join(legacyDir, 'notebook.json'), 'utf8'))
  if (!validNotebook(notebook)) throw new Error('原工作空间数据无效，未迁移或覆盖任何笔记。')
  if (await exists(dataDir) && (await readdir(dataDir)).length)
    throw new Error('客户端数据目录不为空，请通过完整备份导入原有笔记。')
  await mkdir(path.dirname(dataDir), { recursive: true })
  const staging = `${dataDir}.import-${randomUUID()}`
  try {
    await mkdir(staging)
    await cp(path.join(legacyDir, 'notebook.json'), path.join(staging, 'notebook.json'), { mode: constants.COPYFILE_EXCL })
    if (await exists(path.join(legacyDir, 'assets')))
      await cp(path.join(legacyDir, 'assets'), path.join(staging, 'assets'), { recursive: true, force: false, errorOnExist: true })
    if (await exists(dataDir)) await rmdir(dataDir)
    await rename(staging, dataDir)
    return true
  } finally {
    // This is a unique sibling staging directory created above, never the workspace itself.
    await rm(staging, { recursive: true, force: true })
  }
}

async function probe(url, identity) {
  try {
    const address = new URL(url)
    if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1') return false
    const response = await fetch(new URL('/api/health', url), { signal: AbortSignal.timeout(800) })
    const health = await response.json()
    return response.ok && health.application === 'own-notes' && health.workspaceId === identity
  } catch { return false }
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false
  try { process.kill(pid, 0); return true }
  catch (error) { return error.code !== 'ESRCH' }
}

export async function startDesktopHost({
  dataDir,
  legacyDir = path.join(appRoot, 'data'),
  staticDir = path.join(appRoot, 'dist'),
  preferredPort = 5173,
  development = false,
} = {}) {
  if (!dataDir) throw new Error('未指定客户端数据目录。')
  dataDir = path.resolve(dataDir)
  if (!Number.isInteger(preferredPort) || preferredPort < 0 || preferredPort > 65535)
    throw new Error('客户端端口必须是 0–65535 之间的整数。')
  const identity = workspaceIdentity(dataDir)
  const lockPath = `${dataDir}.own-lock`
  await mkdir(path.dirname(dataDir), { recursive: true })
  let lock
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      lock = await open(lockPath, 'wx')
      await lock.writeFile(JSON.stringify({ pid: process.pid }))
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      let owner
      try { owner = JSON.parse(await readFile(lockPath, 'utf8')) } catch {}
      if (owner?.url && await probe(owner.url, identity))
        return { url: owner.url, dataDir, owned: false, migrated: false, close: async () => {} }
      if (!owner || alive(owner.pid))
        throw new Error('这个工作空间已在启动或使用中，请稍后重试。')
      await rm(lockPath)
    }
  }
  if (!lock) throw new Error('无法取得工作空间锁。')
  let server
  const release = async () => { await lock.close(); await rm(lockPath, { force: true }) }
  try {
    // A web service with this exact workspace can be reused, but an unrelated port cannot.
    const preferredUrl = `http://127.0.0.1:${preferredPort}`
    if (preferredPort && await probe(preferredUrl, identity)) {
      await release()
      return { url: preferredUrl, dataDir, owned: false, migrated: false, close: async () => {} }
    }
    const migrated = await prepareWorkspace(dataDir, legacyDir)
    server = await createFieldnotesServer({ dataDir, staticDir, development })
    const listen = (port) => new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve() })
    })
    try { await listen(preferredPort) }
    catch (error) { if (error.code !== 'EADDRINUSE') throw error; await listen(0) }
    const url = `http://127.0.0.1:${server.address().port}`
    await lock.truncate(0)
    await lock.write(JSON.stringify({ pid: process.pid, url }), 0)
    let closing
    return {
      url, dataDir, owned: true, migrated,
      close: () => closing ??= (async () => {
        await new Promise((resolve) => server.close(resolve))
        await release()
      })(),
    }
  } catch (error) {
    if (server?.listening) await new Promise((resolve) => server.close(resolve))
    await release()
    throw error
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const runtime = await startDesktopHost({
      dataDir: process.env.FIELDNOTES_DATA_DIR,
      preferredPort: Number(process.env.OWN_DESKTOP_PORT || 5173),
      development: process.argv.includes('--dev'),
    })
    console.log(JSON.stringify({ event: 'ready', url: runtime.url, dataDir: runtime.dataDir, owned: runtime.owned, migrated: runtime.migrated }))
    let stopping = false
    const stop = async () => {
      if (stopping) return
      stopping = true
      await runtime.close()
      process.exit(0)
    }
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (text) => { if (text.includes('shutdown')) void stop() })
    process.stdin.on('end', () => void stop())
    process.stdin.resume()
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void stop())
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
