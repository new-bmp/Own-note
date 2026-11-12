import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm, mkdir, stat, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire, stripTypeScriptTypes } from 'node:module'
import { sqlProgram } from './sql.mjs'
import { toolchainPaths, executionEnv } from './toolchains.mjs'
const require = createRequire(import.meta.url)
const limit = 262144
const commands = { python: ['python', ['--version']], cpp: ['g++', ['--version']], c: ['gcc', ['--version']], java: ['java', ['--version']], go: ['go', ['version']], rust: ['rustc', ['--version']] }
const specs = { javascript: 'main.mjs', typescript: 'main.mjs', python: 'main.py', sql: 'main.mjs', cpp: 'main.cpp', c: 'main.c', java: 'Main.java', go: 'main.go', rust: 'main.rs' }
const stopping = new WeakSet()
function stop(child) {
  if (!child || child.exitCode !== null || stopping.has(child)) return
  stopping.add(child)
  if (process.platform === 'win32') spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill())
  else { try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } }
}
export function createJobs({ assetsDir, derivedDir }) {
  const jobs = new Map()
  let closed = false
  let capabilities
  const cacheCleanup=mkdir(derivedDir,{recursive:true}).then(async()=>{
    for(const name of await readdir(derivedDir)){
      if(!/^[a-f\d-]{36}\.(mp3|mp4)$/.test(name))continue
      const filename=path.join(derivedDir,name),info=await stat(filename)
      if(Date.now()-info.mtimeMs>86400000)await rm(filename,{force:true})
    }
  }).catch(()=>{})
  function evict(id,job){jobs.delete(id);if(job.outputPath)void rm(job.outputPath,{force:true}).catch(()=>{})}
  function phase(job, command, args, cwd, input = '', timeout = 15000) {
    if (job.reason || closed) return Promise.resolve(1)
    return new Promise((resolve) => {
      const env = executionEnv(cwd)
      const child = spawn(command, args, { cwd, windowsHide: true, detached: process.platform !== 'win32', env, stdio: ['pipe', 'pipe', 'pipe'] })
      job.child = child
      let settled = false
      const finish = (code, error) => { if (settled) return; settled = true; clearTimeout(timer); job.child = undefined; if (error) job.stderr += error.message; resolve(code ?? 1) }
      const append = (key, chunk) => {
        if (job.reason) return
        const text = chunk.toString('utf8')
        if (job.stdout.length + job.stderr.length + text.length > limit) { job.truncated = true; job.reason = '输出超过 256 KB，运行已停止。'; stop(child); return }
        job[key] += text
      }
      const timer = setTimeout(() => { job.reason = '运行超时，已停止。'; stop(child) }, timeout)
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
      child.stdout.on('data', c => append('stdout', c)); child.stderr.on('data', c => append('stderr', c))
      child.on('error', error => finish(1, error)); child.on('close', code => finish(code))
      child.stdin.on('error', () => {}); child.stdin.end(input)
    })
  }
  async function runtimes() {
    if (capabilities) return capabilities
    capabilities = (async () => {
      const items = [{ id: 'javascript', available: true, version: `Node.js ${process.versions.node}` }, { id: 'typescript', available: true, version: 'Node.js TypeScript（去除类型语法）' }, { id: 'sql', available: true, version: 'SQLite 内存数据库' }, { id: 'html', available: true, version: '隔离页面预览' }]
      const paths=toolchainPaths()
      await Promise.all(Object.entries(commands).map(async ([id, [command, args]]) => {
        const job = { stdout: '', stderr: '' }
        const executable=paths[id]
        const code = await phase(job, executable, args, tmpdir(), '', 5000)
        items.push({ id, available: code === 0, bundled:executable!==command, version: code === 0 ? (job.stdout || job.stderr).trim().split('\n')[0] : `未安装 ${command}，可重新运行 Own 安装程序选择该语言组件。` })
      }))
      let ffmpeg
      try { ffmpeg = require('ffmpeg-static'); await stat(ffmpeg) } catch { ffmpeg = null }
      const probe={stdout:'',stderr:''},gdb=await phase(probe,paths.gdb,['--version'],tmpdir(),'',5000)
      return { languages: items, mediaConversion: !!ffmpeg, debugging:['javascript','typescript',...(items.find(i=>i.id==='python'&&i.available)?['python']:[]),...(gdb===0?['c','cpp']:[])] }
    })()
    return capabilities
  }
  function start(kind, input) {
    if (closed) throw new Error('服务正在关闭。')
    if (!input || typeof input !== 'object') throw new Error('运行参数无效。')
    if ([...jobs.values()].filter(j => j.status === 'running').length >= 3) throw new Error('已有 3 个任务运行中，请等待或停止其中一个。')
    if (kind === 'code' && (!specs[input.language] || typeof input.code !== 'string' || input.code.length > 100000 || typeof input.stdin !== 'string' || input.stdin.length > 64000)) throw new Error('代码语言或内容无效（源码 100000 字符，输入 64000 字符）。')
    if (kind === 'media' && (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.assetId) || !['audio','video'].includes(input.type))) throw new Error('媒体附件编号或转换类型无效。')
    for (const [id, job] of jobs) if (job.status !== 'running' && Date.now() - job.finishedAt > 3600000) evict(id,job)
    if (jobs.size >= 100) { const first = [...jobs.values()].find(j => j.status !== 'running'); if(first) evict(first.id,first) }
    const job = { id: randomUUID(), kind, status: 'running', stdout: '', stderr: '', startedAt: Date.now() }
    jobs.set(job.id, job)
    void (async () => {
      const directory = await mkdtemp(path.join(tmpdir(), 'own-lab-'))
      let output
      try {
        if (job.reason) return
        if (kind === 'media') {
          await cacheCleanup
          await mkdir(derivedDir, { recursive: true })
          const metadata = JSON.parse(await readFile(path.join(assetsDir, input.assetId + '.json'), 'utf8'))
          if (!/^[a-f0-9]{64}$/.test(metadata.contentHash)) throw new Error('媒体文件元数据无效。')
          const source = path.join(assetsDir, `${input.assetId}.${metadata.contentHash}.blob`)
          const extension = input.type === 'audio' ? '.mp3' : '.mp4'
          output = path.join(derivedDir, job.id + extension)
          const ffmpeg = require('ffmpeg-static')
          const args = ['-nostdin','-hide_banner','-y','-protocol_whitelist','file,pipe,data,crypto','-i',source,...(input.type === 'audio' ? ['-vn','-c:a','libmp3lame','-b:a','192k'] : ['-map','0:v:0?','-map','0:a:0?','-c:v','libx264','-preset','veryfast','-crf','23','-c:a','aac','-movflags','+faststart']),'-fs','500000000','-progress','pipe:1',output]
          job.exitCode = await phase(job, ffmpeg, args, directory, '', 300000)
          if (job.exitCode === 0 && !job.reason) {
            const info = await stat(output)
            if (!info.size) throw new Error('媒体转换未生成可播放内容。')
            if (info.size >= 500000000) throw new Error('转换结果达到 500 MB 上限，未保留不完整的输出。')
            job.url = `/api/lab/media/${job.id}${extension}`; job.mime = input.type === 'audio' ? 'audio/mpeg' : 'video/mp4'
            job.outputPath=output
          }
        } else {
          let code = input.code
          if (input.language === 'typescript') code = stripTypeScriptTypes(code)
          if (input.language === 'sql') code = sqlProgram(input.code)
          const filename = path.join(directory, specs[input.language])
          await writeFile(filename, code)
          const executable = path.join(directory, process.platform === 'win32' ? 'main.exe' : 'main')
          let command, args
          if (['javascript','typescript','sql'].includes(input.language)) { command=process.execPath; args=['--no-warnings', filename] }
          const paths=toolchainPaths()
          if (input.language === 'python') { command=paths.python; args=['-I','-u',filename] }
          if (input.language === 'java') { command=paths.java; args=[filename] }
          if (input.language === 'go') {
            job.exitCode=await phase(job,paths.go,['build','-o',executable,filename],directory,'',90000)
            if(job.exitCode!==0||job.reason)return
            command=executable;args=[]
          }
          if (['c','cpp','rust'].includes(input.language)) {
            const compilerArgs=[filename,'-o',executable]
            if(input.language==='rust'&&paths.rust!=='rustc'&&paths.c!=='gcc')compilerArgs.push('-C',`linker=${paths.c}`,'-C','link-arg=-no-canonical-prefixes')
            if(input.language!=='rust')compilerArgs.push('-no-canonical-prefixes')
            job.exitCode = await phase(job, paths[input.language], compilerArgs,directory,'',60000)
            if(job.exitCode !== 0 || job.reason) return
            command=executable; args=[]
          }
          if (!job.reason) job.exitCode = await phase(job, command, args, directory, input.stdin, Math.min(30000, Math.max(1000, Number(input.timeoutMs) || 15000)))
        }
      } catch (error) { job.stderr += error.message; job.exitCode = 1 }
      finally {
        job.finishedAt=Date.now(); job.status = job.reason ? 'stopped' : job.exitCode === 0 ? 'success' : 'error'
        if(output&&!job.url)await rm(output,{force:true}).catch(()=>{})
        await rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:100}).catch(()=>{})
      }
    })().catch(error => { job.status='error';job.stderr+=error.message;job.finishedAt=Date.now() })
    return view(job)
  }
  const view = job => { const {child,outputPath,...value}=job; return value }
  return { runtimes, start, get(id) { const job=jobs.get(id); if(!job)throw new Error('运行记录已过期。');return view(job) }, artifact(id){const job=jobs.get(id);if(job?.kind!=='media'||job.status!=='success'||!job.outputPath)throw new Error('转换尚未成功或结果已过期。');return {file:job.outputPath,mime:job.mime}}, cancel(id) { const job=jobs.get(id);if(job?.status==='running'){job.reason='用户停止运行。';stop(job.child)} }, close() { closed=true;for(const job of jobs.values()){if(job.status==='running')job.reason='服务关闭，运行已停止。';stop(job.child)} } }
}
