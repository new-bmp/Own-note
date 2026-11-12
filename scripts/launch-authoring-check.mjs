import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { spawn } from 'node:child_process'
const root = fileURLToPath(new URL('../', import.meta.url))
const check = JSON.parse(await readFile(new URL('../artifacts/authoring-check/latest.json', import.meta.url), 'utf8'))
const child = spawn(path.join(root, 'desktop/bin/Release/net10.0-windows/Own.exe'), [
  '--app-root', root, '--data-dir', check.workspace, '--profile-dir', check.profile, '--state-dir', check.state, '--node', process.execPath, '--port', '0',
], { cwd: root, detached: true, stdio: 'ignore' })
await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
child.unref()
console.log(`独立测试客户端 PID: ${child.pid}`)
