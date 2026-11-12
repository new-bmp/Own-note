import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { spawn } from 'node:child_process'

const root = fileURLToPath(new URL('../', import.meta.url))
const check = JSON.parse(await readFile(new URL('../artifacts/presentation-check/latest.json', import.meta.url), 'utf8'))
const child = spawn(path.join(root, 'desktop/bin/Release/net10.0-windows/Own.exe'), [
  '--app-root', root, '--data-dir', check.workspace, '--profile-dir', check.profile, '--state-dir', check.state, '--node', process.execPath, '--port', '0',
], { cwd: root, detached: true, stdio: 'ignore', windowsHide: false })
await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
child.unref()
await writeFile(new URL('../artifacts/presentation-check/client.pid', import.meta.url), String(child.pid))
console.log(`独立验收客户端 PID: ${child.pid}`)
