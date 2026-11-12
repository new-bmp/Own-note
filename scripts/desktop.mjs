import { spawn } from 'node:child_process'
import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

if (process.platform !== 'win32') throw new Error('此客户端使用 Windows WebView2，请在 Windows 上构建。')
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const { version: appVersion } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const mode = process.argv[2] || 'run'
if (!['run', 'dev', 'package'].includes(mode)) throw new Error('用法：desktop.mjs run | dev | package')
const installerPayload = mode === 'package' && process.argv.includes('--installer')
if (process.argv.slice(3).some((arg) => arg !== '--installer' || mode !== 'package'))
  throw new Error('只支持 package --installer 构建独立安装包目录。')
const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('请通过 npm run desktop 或 npm run desktop:package 运行。')

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} 退出，状态 ${code}`)))
  })
}
const npm = (args, options) => run(process.execPath, [npmCli, ...args], options)
const project = path.join(root, 'desktop', 'Own.Desktop.csproj')

async function readNodeLicense() {
  const local = path.join(path.dirname(process.execPath), 'LICENSE')
  if (existsSync(local)) return readFile(local, 'utf8')
  const previous = path.join(root, 'release', 'Own-win-x64')
  try {
    const version = JSON.parse(await readFile(path.join(previous, '版本.json'), 'utf8'))
    if (version.node === process.versions.node) {
      const license = await readFile(path.join(previous, 'runtime', 'NODE-LICENSE.txt'), 'utf8')
      if (license.startsWith('Node.js is licensed for use as follows:')) return license
    }
  } catch { /* A first package build has no previous runtime to reuse. */ }
  const version = `v${process.versions.node}`
  for (const url of [
    `https://raw.githubusercontent.com/nodejs/node/${version}/LICENSE`,
    `https://cdn.jsdelivr.net/gh/nodejs/node@${version}/LICENSE`,
  ]) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      if (!response.ok) continue
      const license = await response.text()
      if (license.startsWith('Node.js is licensed for use as follows:')) return license
    } catch { /* Try the mirror of the same versioned source file. */ }
  }
  throw new Error('无法读取 Node.js 发行许可，请检查网络或将官方 LICENSE 放在 node.exe 同目录。')
}

await npm(['run', 'build'])
if (mode !== 'package') {
  await run('dotnet', ['build', project, '-c', 'Release', `-p:Version=${appVersion}`, '--nologo'])
  const args = ['--app-root', root, '--node', process.execPath]
  if (mode === 'dev') args.push('--dev')
  const child = spawn(path.join(root, 'desktop', 'bin', 'Release', 'net10.0-windows', 'Own.exe'), args, { cwd: root, stdio: 'ignore', detached: true, windowsHide: false })
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
  child.unref()
  console.log('已启动 Own 桌面客户端。')
} else {
  const release = path.join(root, 'release')
  const staging = path.join(release, `.own-build-${randomUUID()}`)
  const app = path.join(staging, 'app')
  await mkdir(staging, { recursive: true })
  await run('dotnet', ['publish', project, '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true', '-p:PublishSingleFile=true', `-p:Version=${appVersion}`, '-o', staging, '--nologo'])
  await mkdir(path.join(app, 'desktop'), { recursive: true })
  for (const entry of ['server.mjs', 'mcp-stdio.mjs', 'mcp', 'shared', 'dist', 'package.json', 'package-lock.json'])
    await cp(path.join(root, entry), path.join(app, entry), { recursive: true })
  await cp(path.join(root, 'desktop', 'host.mjs'), path.join(app, 'desktop', 'host.mjs'))
  await npm(['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', app])
  await mkdir(path.join(staging, 'runtime'))
  await cp(process.execPath, path.join(staging, 'runtime', 'node.exe'))
  const license = await readNodeLicense()
  await writeFile(path.join(staging, 'runtime', 'NODE-LICENSE.txt'), license)
  await cp(path.join(root, 'docs', 'desktop.md'), path.join(staging, '使用说明.md'))
  await writeFile(path.join(staging, '版本.json'), JSON.stringify({ name: 'Own', version: appVersion, platform: 'win-x64', node: process.versions.node, engine: 'WebView2' }, null, 2))
  const output = path.join(release, installerPayload ? 'Own-app-win-x64' : 'Own-win-x64')
  if (existsSync(output)) await rename(output, `${output}.previous-${Date.now()}`)
  await rename(staging, output)
  if (installerPayload) console.log(`安装包资源：${output}`)
  else {
    const archive = path.join(release, 'Own-win-x64.zip')
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Compress-Archive -LiteralPath $env:OWN_PACKAGE_SOURCE -DestinationPath $env:OWN_PACKAGE_ARCHIVE -Force'], {
      env: { ...process.env, OWN_PACKAGE_SOURCE: output, OWN_PACKAGE_ARCHIVE: archive },
    })
    console.log(`客户端：${path.join(output, 'Own.exe')}\n分发包：${archive}`)
  }
}
