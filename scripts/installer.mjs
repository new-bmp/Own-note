import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const installerPackage = path.join(root, 'release', 'Own-app-win-x64')

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} 退出，状态 ${code}`)))
  })
}

export async function compileInstaller({ packageDir = installerPackage, outputDir = path.join(root, 'release'), test = false } = {}) {
  if (process.platform !== 'win32') throw new Error('请在 Windows 上构建 Own 安装程序。')
  const compiler = process.env.OWN_ISCC || path.join(root, 'node_modules', 'innosetup-compiler', 'bin', 'ISCC.exe')
  if (!existsSync(compiler)) throw new Error('未找到 Inno Setup 编译器，请先 npm install，或通过 OWN_ISCC 指定 ISCC.exe。')
  for (const entry of ['Own.exe', 'runtime/node.exe', 'runtime/NODE-LICENSE.txt', 'app/server.mjs', 'app/desktop/host.mjs', 'app/mcp/server.mjs', 'app/dist/index.html']) {
    if (!existsSync(path.join(packageDir, entry))) throw new Error(`桌面包不完整，缺少 ${entry}。请先运行 npm run desktop:package。`)
  }
  for (const entry of ['data', 'workspace', 'artifacts', 'videos', 'app/data', 'app/artifacts', 'app/videos']) {
    if (existsSync(path.join(packageDir, entry))) throw new Error(`桌面包内包含 ${entry}，拒绝将工作空间或开发资料打包。`)
  }
  const metadata = JSON.parse(await readFile(path.join(packageDir, '版本.json'), 'utf8'))
  if (!/^\d+\.\d+\.\d+$/.test(metadata.version)) throw new Error('安装包需要三段式版本号。')
  await mkdir(outputDir, { recursive: true })
  const args = [
    '/Qp',
    `/DPackageDir=${path.resolve(packageDir)}`,
    `/DOutputDir=${path.resolve(outputDir)}`,
    `/DAppVersion=${metadata.version}`,
    ...(test ? ['/DInstallerTest=1'] : []),
    path.join(root, 'desktop', 'installer', 'Own.iss'),
  ]
  await run(compiler, args)
  const output = path.join(outputDir, test ? 'Own-Setup-test.exe' : 'Own-Setup.exe')
  if (!test) {
    const hash = createHash('sha256').update(await readFile(output)).digest('hex')
    await writeFile(output + '.sha256', `${hash}  ${path.basename(output)}\n`)
  }
  return output
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fromPackage = process.argv.includes('--from-package')
  if (process.argv.slice(2).some((arg) => arg !== '--from-package')) throw new Error('用法：npm run desktop:installer [-- --from-package]')
  if (!fromPackage) {
    if (!process.env.npm_execpath) throw new Error('请通过 npm run desktop:installer 运行。')
    await run(process.execPath, [process.env.npm_execpath, 'run', 'desktop:package', '--', '--installer'])
  }
  console.log(`安装程序：${await compileInstaller()}`)
}
