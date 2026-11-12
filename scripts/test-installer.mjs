import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { compileInstaller, installerPackage } from './installer.mjs'

if (process.platform !== 'win32') throw new Error('安装验收需要 Windows。')
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const artifactDir = path.join(root, 'artifacts', 'installer-check')
const packageDir = installerPackage
const registryKey = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Own.Notes.InstallerTest_is1'
const appName = 'Own 安装验收'

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', (data) => { stdout += data })
    child.stderr.on('data', (data) => { stderr += data })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`${path.basename(command)} 退出 ${code}\n${stderr || stdout}`)))
  })
}
const powershell = (command, env) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); " + command], env)
const digest = async (filename) => createHash('sha256').update(await readFile(filename)).digest('hex')
const readRegistration = async () => JSON.parse(await powershell('$ownEntry = Get-ItemProperty -LiteralPath $env:OWN_INSTALL_TEST_REGISTRY -ErrorAction SilentlyContinue; if ($ownEntry) { $ownEntry | Select-Object DisplayName,DisplayVersion,InstallLocation | ConvertTo-Json -Compress } else { "null" }', { OWN_INSTALL_TEST_REGISTRY: registryKey }))
const exists = (filename) => existsSync(filename)

async function startHost(installDir, dataDir) {
  const child = spawn(path.join(installDir, 'runtime', 'node.exe'), [path.join(installDir, 'app', 'desktop', 'host.mjs')], {
    cwd: installDir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, FIELDNOTES_DATA_DIR: dataDir, OWN_DESKTOP_PORT: '0' },
  })
  let output = '', errors = ''
  child.stderr.on('data', (chunk) => { errors += chunk })
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.stdin.end(); reject(new Error(`随包服务启动超时：${errors}`)) }, 20000)
    child.stdout.on('data', (chunk) => {
      output += chunk
      const line = output.split('\n').find((line) => line.startsWith('{') && line.endsWith('}'))
      if (line) { clearTimeout(timer); resolve(JSON.parse(line)) }
    })
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`随包服务退出 ${code}：${errors}`)) })
  })
  return {
    url: ready.url,
    close: async () => {
      if (child.exitCode !== null) return
      const exit = once(child, 'exit')
      child.stdin.end()
      assert.equal((await exit)[0], 0, errors)
    },
  }
}

await mkdir(artifactDir, { recursive: true })
assert.equal(await readRegistration(), null, '存在未清理的安装验收项，保留该项并停止。')
const folders = JSON.parse(await powershell("[PSCustomObject]@{ programs = [Environment]::GetFolderPath('Programs'); desktop = [Environment]::GetFolderPath('Desktop'); local = [Environment]::GetFolderPath('LocalApplicationData') } | ConvertTo-Json -Compress"))
const menuShortcut = path.join(folders.programs, `${appName}.lnk`)
const desktopShortcut = path.join(folders.desktop, `${appName}.lnk`)
assert.ok(!exists(menuShortcut) && !exists(desktopShortcut), '测试快捷方式已存在，停止以免覆盖。')
const realNotebook = path.join(folders.local, 'Own', 'workspace', 'notebook.json')
const realHash = exists(realNotebook) ? await digest(realNotebook) : null
const temporary = await mkdtemp(path.join(tmpdir(), 'own-install-test-'))
const installDir = path.join(temporary, 'Own 安装路径')
const dataDir = path.join(temporary, 'workspace')
const uninstaller = path.join(installDir, 'unins000.exe')
const installLog = path.join(temporary, 'install.log')
const upgradeLog = path.join(temporary, 'upgrade.log')
const uninstallLog = path.join(temporary, 'uninstall.log')
let host
const clients = []
const checks = []
try {
  const installer = await compileInstaller({ outputDir: artifactDir, test: true })
  const installArgs = ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', `/DIR=${installDir}`, '/TASKS=desktopicon']
  await run(installer, [...installArgs, `/LOG=${installLog}`])
  const registration = await readRegistration()
  const version = JSON.parse(await readFile(path.join(packageDir, '版本.json'), 'utf8')).version
  assert.equal(registration.DisplayName, appName)
  assert.equal(registration.DisplayVersion, version)
  assert.equal(path.resolve(registration.InstallLocation), installDir)
  assert.ok(exists(menuShortcut) && exists(desktopShortcut))
  const target = await powershell('$ownShell = New-Object -ComObject WScript.Shell; $ownLink = $ownShell.CreateShortcut($env:OWN_INSTALL_TEST_LINK); [PSCustomObject]@{ target = $ownLink.TargetPath; directory = $ownLink.WorkingDirectory } | ConvertTo-Json -Compress', { OWN_INSTALL_TEST_LINK: menuShortcut })
  assert.equal(path.resolve(JSON.parse(target).target), path.join(installDir, 'Own.exe'))
  assert.equal(path.resolve(JSON.parse(target).directory), installDir)
  for (const entry of ['Own.exe', 'runtime/node.exe', 'app/server.mjs', 'app/mcp/server.mjs', 'app/mcp/conversations.mjs', 'app/dist/index.html']) {
    assert.equal(await digest(path.join(installDir, entry)), await digest(path.join(packageDir, entry)), entry)
  }
  const packagedFiles = (await readdir(packageDir, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).length
  const installedFiles = (await readdir(installDir, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).length
  assert.ok(installedFiles >= packagedFiles)
  assert.ok(!exists(path.join(installDir, 'app', 'node_modules', 'innosetup-compiler')))
  checks.push('当前用户安装、中文路径、开始菜单/桌面快捷方式、卸载登记、随包文件一致性')

  host = await startHost(installDir, dataDir)
  const client = new Client({ name: 'own-installer-check', version: '1.0.0' })
  clients.push(client)
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', host.url)))
  assert.equal((await client.listTools()).tools.length, 10)
  const args = {
    requestId: 'installed-own-check', title: '安装程序验收', summary: '验证安装后的 Node.js 和 MCP 服务。',
    markdown: '## 验收\n\n完整正文保留。\n\n| 检查 | 状态 |\n| --- | --- |\n| 安装 | 通过 |\n\n正文末尾：INSTALLED-OWN-END。\n',
    actions: [{ text: '保留工作空间，卸载程序', done: false }],
    equations: [{ title: '示例公式', latex: 'P = \\frac{n}{N}' }],
    diagrams: [{ title: '示例流程', mermaid: 'flowchart LR\n A[安装] --> B[保存]\n B --> C[读回]' }],
  }
  const saved = await client.callTool({ name: 'own_save_conversation', arguments: args })
  assert.ok(!saved.isError, JSON.stringify(saved.content))
  assert.equal(saved.structuredContent.verification.markdown.exactMatch, true)
  const attachmentId = 'installed-folder-asset'
  const attachmentBytes = Buffer.from([0, 255, 8, 32, 0, 14])
  assert.equal((await fetch(host.url + '/api/assets/' + attachmentId, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: attachmentBytes })).status, 200)
  const snapshot = await fetch(host.url + '/api/notebook')
  const { notebook } = await snapshot.json()
  const targetBoard = notebook.boards.find((board) => board.id === notebook.activeBoardId)
  const folder = { id: 'installed-folder', kind: 'folder', title: '随包文件夹验收', x: 20, y: 900, width: 340, height: 310, entries: [{ path: '空目录', kind: 'directory' }, { path: '资料', kind: 'directory' }, { path: '资料/原文件.custom', kind: 'file', assetId: attachmentId, size: attachmentBytes.length, mime: 'application/octet-stream' }] }
  targetBoard.notes.push(folder)
  targetBoard.connections.push({ id: 'installed-connection', from: targetBoard.notes[0].id, to: folder.id, style: 'elbow', arrow: 'both', dashed: true, label: '完整资料', color: '#397aa5', fromSide: 'bottom', toSide: 'top' })
  assert.equal((await fetch(host.url + '/api/notebook', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': snapshot.headers.get('etag') }, body: JSON.stringify(notebook) })).status, 200)
  const mathFonts = (await readdir(path.join(installDir, 'app/dist/mathlive/fonts'))).filter((name) => name.endsWith('.woff2'))
  assert.ok(mathFonts.length > 5)
  const fontResponse = await fetch(host.url + '/mathlive/fonts/' + mathFonts[0])
  assert.equal(fontResponse.status, 200)
  assert.match(fontResponse.headers.get('content-type'), /font\/woff2/)
  checks.push('文件夹、空目录、任意二进制附件、关系文字与连线样式保存，数学输入字体随包离线加载')
  const workspaceHash = await digest(path.join(dataDir, 'notebook.json'))
  await client.close()
  await host.close()
  host = undefined
  checks.push('安装后的随包 Node.js、10 个 MCP 工具、完整正文、公式及 Mermaid 保存')

  const customFile = path.join(installDir, 'user-keep.txt')
  await writeFile(customFile, '用户额外放置的文件不得被覆盖升级或卸载清除。')
  await run(installer, [...installArgs, `/LOG=${upgradeLog}`])
  assert.equal(await digest(path.join(dataDir, 'notebook.json')), workspaceHash)
  assert.ok(exists(customFile))
  host = await startHost(installDir, dataDir)
  assert.deepEqual(Buffer.from(await (await fetch(host.url + '/api/assets/' + attachmentId)).arrayBuffer()), attachmentBytes)
  const upgraded = (await (await fetch(host.url + '/api/notebook')).json()).notebook
  const upgradedBoard = upgraded.boards.find((board) => board.id === targetBoard.id)
  assert.deepEqual(upgradedBoard.notes.find((note) => note.id === folder.id), folder)
  assert.deepEqual(upgradedBoard.connections.find((edge) => edge.id === 'installed-connection'), targetBoard.connections.at(-1))
  const stdio = new Client({ name: 'own-installed-stdio-check', version: '1.0.0' })
  clients.push(stdio)
  await stdio.connect(new StdioClientTransport({
    command: path.join(installDir, 'runtime', 'node.exe'),
    args: [path.join(installDir, 'app', 'mcp-stdio.mjs')],
    env: { ...process.env, OWN_URL: host.url }, stderr: 'pipe',
  }))
  const read = await stdio.callTool({ name: 'own_read_conversation', arguments: { requestId: args.requestId, includeOriginal: true } })
  assert.ok(!read.isError, JSON.stringify(read.content))
  assert.equal(read.structuredContent.originalMarkdown, args.markdown)
  assert.equal(read.structuredContent.verification.status, 'verified')
  await stdio.close()
  await host.close()
  host = undefined
  checks.push('覆盖升级保留数据和额外文件，升级后通过随包 stdio 读回完整记录')

  await run(uninstaller, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', `/LOG=${uninstallLog}`])
  assert.equal(await digest(path.join(dataDir, 'notebook.json')), workspaceHash)
  assert.ok(exists(customFile))
  assert.ok(!exists(path.join(installDir, 'Own.exe')))
  assert.ok(!exists(menuShortcut) && !exists(desktopShortcut))
  assert.equal(await readRegistration(), null)
  assert.equal(exists(realNotebook) ? await digest(realNotebook) : null, realHash)
  checks.push('卸载移除程序/快捷方式/登记，保留笔记与额外文件，用户原笔记逐字节未变')
  const report = { passed: true, installerVersion: version, packageFiles: packagedFiles, installedFiles, checks }
  await writeFile(path.join(artifactDir, 'result.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await Promise.allSettled(clients.map((client) => client.close()))
  if (host) await host.close()
  // Only remove this run's UUID-like temporary directory after the test
  // uninstaller has removed its separate registration and shortcuts.
  if (exists(uninstaller) && await readRegistration())
    await run(uninstaller, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', `/LOG=${uninstallLog}`])
  for (const filename of [installLog, upgradeLog, uninstallLog])
    if (exists(filename)) await cp(filename, path.join(artifactDir, path.basename(filename)))
  if (await readRegistration()) throw new Error(`测试卸载项仍存在，保留验收目录：${temporary}`)
  assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()))
  assert.ok(path.basename(temporary).startsWith('own-install-test-'))
  await rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
}
