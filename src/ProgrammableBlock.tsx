import { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, Plus, Radio, RefreshCw, Square, Trash2 } from 'lucide-react'
import type { CanvasNote, ProgramAnimation, ProgramApp, ProgramDriver, ProgramFrame } from './model'
import { uid } from './model'
import { CodeNotebook } from './CodeNotebook'

const animationDefault: ProgramAnimation = { width: 640, height: 360, durationMs: 3000, loop: true, frames: [{ at: 0, values: { x: 0, y: 0, opacity: 1 } }, { at: 3000, values: { x: 320, y: 180, opacity: 1 } }] }
const flaskExample = `from flask import Flask, request, jsonify
import os

app = Flask(__name__)

@app.get('/')
def home():
    return '''<!doctype html><meta charset="utf-8"><title>Own Flask App</title>
    <style>body{font:16px system-ui;padding:32px;color:#26384f}button{padding:8px 14px}</style>
    <h1>Own 可编程应用</h1><p>这是画布内运行的 Flask 界面。</p>
    <button onclick="fetch('/echo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:'画布',time:Date.now()})}).then(r=>r.json()).then(x=>document.querySelector('pre').textContent=JSON.stringify(x,null,2))">发送响应请求</button>
    <pre>点击按钮查看响应</pre>'''

@app.post('/echo')
def echo():
    payload = request.get_json(silent=True) or request.form.to_dict() or {'body': request.data.decode('utf-8', 'replace')}
    return jsonify(ok=True, received=payload)

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=int(os.environ.get('OWN_APP_PORT', '5000')), debug=False)
`

type AppStatus = {
  id: string
  status: string
  runtime?: string
  port?: number
  url?: string
  error?: string
  requestCount?: number
  logs?: { at: number; stream: string; text: string }[]
}

type AppResponse = {
  appId?: string
  method?: string
  path?: string
  status: number
  headers?: Record<string, string>
  body: string
  truncated?: boolean
}

function frameAt(animation: ProgramAnimation, time: number) {
  const ordered = [...animation.frames].sort((a, b) => a.at - b.at)
  return ordered.reduce<ProgramFrame | undefined>((current, frame) => frame.at <= time ? frame : current, ordered[0]) || { at: 0, values: {} }
}

export function ProgrammableBlock({ note, onChange, onBusy }: { note: CanvasNote; onChange: (patch: Partial<CanvasNote>) => void; onBusy: (busy: boolean) => void }) {
  const animation = note.animation || animationDefault
  const appConfig: ProgramApp = note.programApp || { framework: 'flask', enabled: false }
  const cells = note.cells || []
  const appCell = cells.find(cell => cell.id === appConfig.entryCellId && cell.language === 'python') || cells.find(cell => cell.language === 'python')
  const [playing, setPlaying] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [driverMessage, setDriverMessage] = useState('')
  const [connectedDrivers, setConnectedDrivers] = useState<string[]>([])
  const [driverBuffers, setDriverBuffers] = useState<Record<string, string>>({})
  const [driverPayload, setDriverPayload] = useState<Record<string, string>>({})
  const [appId] = useState(() => `program-${note.id}`)
  const [appStatus, setAppStatus] = useState<AppStatus | null>(null)
  const [appMessage, setAppMessage] = useState('')
  const [appMethod, setAppMethod] = useState('GET')
  const [appPath, setAppPath] = useState('/')
  const [appBody, setAppBody] = useState('')
  const [appResponse, setAppResponse] = useState<AppResponse | null>(null)
  const [appBusy, setAppBusy] = useState(false)
  const startedAt = useRef(0)
  const frame = useMemo(() => frameAt(animation, elapsed), [animation, elapsed])

  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = (now: number) => {
      if (!startedAt.current) startedAt.current = now - elapsed
      const value = now - startedAt.current
      if (value >= animation.durationMs && !animation.loop) { setElapsed(animation.durationMs); setPlaying(false); return }
      setElapsed(animation.loop ? value % animation.durationMs : value)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // elapsed is intentionally captured when playback starts; the frame loop updates it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, animation.durationMs, animation.loop])

  useEffect(() => {
    let active = true
    void fetch(`/api/program/apps/${encodeURIComponent(appId)}/status`).then(response => response.json()).then(value => { if (active && ['starting', 'running'].includes(value.status)) setAppStatus(value) }).catch(() => {})
    return () => { active = false }
  }, [appId])

  useEffect(() => {
    if (!appStatus || !['starting', 'running'].includes(appStatus.status)) return
    let active = true
    const refresh = async () => {
      try {
        const response = await fetch(`/api/program/apps/${encodeURIComponent(appId)}/status`)
        const value = await response.json()
        if (active) setAppStatus(value)
      } catch { /* the next poll or explicit action reports connection errors */ }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 1000)
    return () => { active = false; clearInterval(timer) }
  }, [appId, appStatus?.status])

  useEffect(() => () => { void fetch(`/api/program/apps/${encodeURIComponent(appId)}/stop`, { method: 'POST' }).catch(() => {}) }, [appId])

  function updateAnimation(patch: Partial<ProgramAnimation>) { onChange({ animation: { ...animation, ...patch } }) }
  function updateFrame(index: number, patch: Partial<ProgramFrame>) { updateAnimation({ frames: animation.frames.map((item, i) => i === index ? { ...item, ...patch } : item) }) }
  function addFrame() {
    const at = Math.min(animation.durationMs, Math.round(elapsed))
    updateAnimation({ frames: [...animation.frames, { at, values: { x: 0, y: 0, opacity: 1 } }] })
  }
  function updateDriver(index: number, patch: Partial<ProgramDriver>) { onChange({ programDrivers: (note.programDrivers || []).map((driver, i) => i === index ? { ...driver, ...patch } : driver) }) }
  function addDriver() { onChange({ programDrivers: [...(note.programDrivers || []), { id: uid(), name: '新驱动', type: 'tcp', host: '127.0.0.1', port: 4000, encoding: 'utf8', enabled: true }] }) }
  function updateApp(patch: Partial<ProgramApp>) { onChange({ programApp: { ...appConfig, ...patch } }) }

  function insertFlaskExample() {
    const existing = cells.find(cell => cell.language === 'python')
    if (existing) {
      onChange({ cells: cells.map(cell => cell.id === existing.id ? { ...cell, code: flaskExample, stdin: '', output: undefined, error: undefined } : cell), programApp: { ...appConfig, enabled: true, entryCellId: existing.id } })
      return
    }
    const id = uid()
    onChange({ cells: [...cells, { id, language: 'python', code: flaskExample, stdin: '' }], programApp: { ...appConfig, enabled: true, entryCellId: id } })
  }

  async function startApp() {
    if (!appCell) { setAppMessage('请先添加一个 Python 单元，或点击“插入 Flask 示例”。'); return }
    setAppBusy(true); onBusy(true); setAppMessage('正在启动应用…'); setAppResponse(null)
    try {
      const response = await fetch('/api/program/apps/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: appId, framework: 'flask', language: appCell.language, code: appCell.code, port: appConfig.port }) })
      const value = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(value.error || '应用启动失败。')
      setAppStatus(value)
      setAppMessage(value.runtime === 'own-flask-compat' ? '真实 Flask 未安装，已使用 Own 离线兼容层；常用路由、request、jsonify 和 HTML 可用。' : 'Flask 应用已启动，界面和接口都在这个可编程块内。')
    } catch (error) { setAppMessage(error instanceof Error ? error.message : '应用启动失败。'); setAppStatus(null) }
    finally { setAppBusy(false); onBusy(false) }
  }

  async function stopApp() {
    setAppBusy(true); onBusy(true)
    try { const response = await fetch(`/api/program/apps/${encodeURIComponent(appId)}/stop`, { method: 'POST' }); setAppStatus(await response.json()); setAppMessage('应用已停止。') }
    catch (error) { setAppMessage(error instanceof Error ? error.message : '停止应用失败。') }
    finally { setAppBusy(false); onBusy(false) }
  }

  async function requestApp() {
    setAppBusy(true); onBusy(true); setAppMessage('正在请求应用…')
    try {
      let headers: Record<string, string> | undefined
      if (appBody) {
        try { JSON.parse(appBody); headers = { 'Content-Type': 'application/json' } }
        catch { headers = { 'Content-Type': 'text/plain; charset=utf-8' } }
      }
      const response = await fetch(`/api/program/apps/${encodeURIComponent(appId)}/request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: appMethod, path: appPath || '/', headers, body: appBody }) })
      const value = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(value.error || '请求失败。')
      setAppResponse(value); setAppMessage(`收到 ${value.status} 响应。`)
    } catch (error) { setAppMessage(error instanceof Error ? error.message : '请求失败。') }
    finally { setAppBusy(false); onBusy(false) }
  }

  async function connect(driver: ProgramDriver) {
    if (!window.confirm(`即将连接 ${driver.type}：${driver.host || '未填写主机'}:${driver.port || '未填写端口'}。确认地址和数据方向后再继续；不要连接不熟悉的设备。`)) return
    setDriverMessage('')
    try {
      const response = await fetch('/api/program/drivers/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ driver, confirmed: true }) })
      const value = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(value.error || '连接失败。')
      setConnectedDrivers(current => current.includes(driver.id) ? current : [...current, driver.id])
      setDriverMessage(`${driver.name || driver.type} 已连接。`)
    } catch (error) { setDriverMessage(error instanceof Error ? error.message : '连接失败，请先启动本地服务。') }
  }

  async function send(driver: ProgramDriver) {
    const data = driverPayload[driver.id] || ''
    if (!data) return
    try {
      const response = await fetch('/api/program/drivers/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: driver.id, data, encoding: driver.encoding || 'utf8' }) })
      const value = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(value.error || '发送失败。')
      setDriverPayload(current => ({ ...current, [driver.id]: '' }))
      setDriverMessage(`${driver.name || driver.type} 已发送 ${value.bytes || data.length} 字节。`)
    } catch (error) { setDriverMessage(error instanceof Error ? error.message : '发送失败。') }
  }

  useEffect(() => {
    if (!connectedDrivers.length) return
    let active = true
    const read = async () => {
      await Promise.all(connectedDrivers.map(async id => {
        try {
          const response = await fetch('/api/program/drivers/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, offset: 0, limit: 50 }) })
          if (!response.ok) return
          const value = await response.json()
          if (active && Array.isArray(value.events)) setDriverBuffers(current => ({ ...current, [id]: value.events.map((event: { at: number; data: string }) => `${new Date(event.at).toLocaleTimeString()}  ${event.data}`).join('\n') }))
        } catch { /* connection errors are shown by the next explicit action */ }
      }))
    }
    void read()
    const timer = setInterval(() => void read(), 700)
    return () => { active = false; clearInterval(timer) }
  }, [connectedDrivers])

  const x = typeof frame.values.x === 'number' ? frame.values.x : 0
  const y = typeof frame.values.y === 'number' ? frame.values.y : 0
  const opacity = typeof frame.values.opacity === 'number' ? Math.max(0, Math.min(1, frame.values.opacity)) : 1
  return <div className="programmable-block">
    <section className="program-section"><header className="program-section-heading"><div><strong>可编程单元</strong><span>按步运行 · 变量查看 · 输入输出</span></div><span className="program-badge">PROGRAM</span></header><CodeNotebook note={note} onChange={onChange} onBusy={onBusy} /></section>
    <section className="program-section program-app"><header className="program-section-heading"><div><strong>应用界面 · Flask</strong><span>代码、界面、接口和响应都在同一个可编程块里</span></div><span className="program-badge">APP</span></header>
      <div className="program-app-toolbar"><label className="lab-checkbox"><input type="checkbox" checked={appConfig.enabled} onChange={event => updateApp({ enabled: event.target.checked })} />启用应用</label><label>入口 Python 单元<select value={appConfig.entryCellId || appCell?.id || ''} onChange={event => updateApp({ entryCellId: event.target.value || undefined })}><option value="">选择单元</option>{cells.filter(cell => cell.language === 'python').map(cell => <option key={cell.id} value={cell.id}>{cell.id === appCell?.id ? '当前入口' : `Python · ${cell.id.slice(0, 8)}`}</option>)}</select></label><label>端口<input type="number" min={1024} max={65535} value={appConfig.port || ''} placeholder="自动分配" onChange={event => updateApp({ port: Number(event.target.value) || undefined })} /></label><button onClick={insertFlaskExample}>插入 Flask 示例</button><button onClick={() => void startApp()} disabled={appBusy || !appConfig.enabled || !appCell}><Play size={13} />启动应用</button><button onClick={() => void stopApp()} disabled={appBusy || !appStatus || appStatus.status === 'stopped'}><Square size={13} />停止</button></div>
      {appMessage && <p className="lab-help" role="status">{appMessage}</p>}
      {appStatus && <p className={`program-app-status status-${appStatus.status}`}><strong>{appStatus.status === 'running' ? '运行中' : appStatus.status === 'starting' ? '启动中' : appStatus.status === 'error' ? '启动失败' : '已停止'}</strong>{appStatus.port ? ` · 127.0.0.1:${appStatus.port}` : ''}{appStatus.requestCount ? ` · 已处理 ${appStatus.requestCount} 次请求` : ''}{appStatus.error && <span> · {appStatus.error}</span>}</p>}
      {appStatus?.status === 'running' && appStatus.url && <iframe className="program-app-preview" title="可编程块 Flask 应用界面" src={appStatus.url} sandbox="allow-forms allow-modals allow-popups allow-scripts" referrerPolicy="no-referrer" />}
      <div className="program-app-request"><div className="program-app-request-heading"><strong>请求与响应</strong><span>用程序接收表单、JSON 或设备转发结果</span></div><div className="program-app-request-row"><select aria-label="应用请求方法" value={appMethod} onChange={event => setAppMethod(event.target.value)}><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select><input aria-label="应用请求路径" value={appPath} onChange={event => setAppPath(event.target.value)} placeholder="/api/echo" /><button onClick={() => void requestApp()} disabled={appBusy || appStatus?.status !== 'running'}><RefreshCw size={13} />发送请求</button></div><textarea aria-label="应用请求正文" value={appBody} onChange={event => setAppBody(event.target.value)} placeholder={'请求正文，例如 {"value":42}'} />{appResponse && <div className="program-app-response"><div><strong>{appResponse.status}</strong> {appResponse.method} {appResponse.path}{appResponse.truncated ? ' · 响应已截断' : ''}</div><details><summary>响应头</summary><pre>{JSON.stringify(appResponse.headers || {}, null, 2)}</pre></details><pre>{appResponse.body || '（空响应）'}</pre></div>}</div>
      {appStatus?.logs?.length ? <details className="program-app-logs"><summary>运行日志（最近 {appStatus.logs.length} 条）</summary><pre>{appStatus.logs.map(log => `[${new Date(log.at).toLocaleTimeString()}] ${log.stream}: ${log.text}`).join('\n')}</pre></details> : null}
    </section>
    <section className="program-section program-animation"><header className="program-section-heading"><div><strong>动画制作器</strong><span>关键帧在本机预览，不会自动连接外部设备</span></div><div className="program-toolbar"><button onClick={() => { if (playing) setPlaying(false); else { startedAt.current = 0; setPlaying(true) } }}>{playing ? <Pause size={14} /> : <Play size={14} />}{playing ? '暂停' : '预览'}</button><button onClick={addFrame}><Plus size={14} />关键帧</button></div></header>
      <div className="program-animation-stage" style={{ aspectRatio: `${animation.width} / ${animation.height}` }}><div className="program-animation-object" style={{ transform: `translate(${x}px, ${y}px)`, opacity }} /><span className="program-animation-time">{Math.round(elapsed)} / {animation.durationMs} ms</span></div>
      <div className="program-animation-controls"><label>时长 <input type="number" min={100} max={86400000} value={animation.durationMs} onChange={event => updateAnimation({ durationMs: Math.max(100, Number(event.target.value) || 100) })} /></label><label className="lab-checkbox"><input type="checkbox" checked={animation.loop} onChange={event => updateAnimation({ loop: event.target.checked })} />循环</label><input aria-label="动画时间轴" type="range" min={0} max={animation.durationMs} value={Math.min(animation.durationMs, elapsed)} onChange={event => { setPlaying(false); setElapsed(Number(event.target.value)) }} /></div>
      <div className="program-keyframes">{animation.frames.map((item, index) => <div className="program-keyframe" key={`${index}-${item.at}`}><label>时间<input type="number" min={0} max={animation.durationMs} value={item.at} onChange={event => updateFrame(index, { at: Math.max(0, Math.min(animation.durationMs, Number(event.target.value) || 0)) })} /></label><label>变量 JSON<textarea value={JSON.stringify(item.values)} onChange={event => { try { const values = JSON.parse(event.target.value); if (values && typeof values === 'object' && !Array.isArray(values)) updateFrame(index, { values }) } catch { /* keep the last valid keyframe while editing */ } }} /></label><button aria-label={`删除第 ${index + 1} 个关键帧`} onClick={() => updateAnimation({ frames: animation.frames.filter((_, i) => i !== index) })} disabled={animation.frames.length <= 1}><Trash2 size={14} /></button></div>)}</div>
    </section>
    <section className="program-section program-drivers"><header className="program-section-heading"><div><strong>设备与网络驱动</strong><span>TCP、Serial over LAN、UDP、WebSocket</span></div><button onClick={addDriver}><Plus size={14} />添加驱动</button></header>{driverMessage && <p className="lab-help" role="status">{driverMessage}</p>}{(note.programDrivers || []).map((driver, index) => <article className="program-driver" key={driver.id}><div className="program-driver-title"><Radio size={15} /><input value={driver.name || ''} aria-label="驱动名称" onChange={event => updateDriver(index, { name: event.target.value })} /><select value={driver.type} aria-label="驱动类型" onChange={event => updateDriver(index, { type: event.target.value as ProgramDriver['type'] })}><option value="tcp">TCP</option><option value="serial-lan">Serial over LAN</option><option value="udp">UDP</option><option value="websocket">WebSocket</option></select><button onClick={() => void connect(driver)}><RefreshCw size={13} />连接</button><button aria-label="删除驱动" onClick={() => onChange({ programDrivers: (note.programDrivers || []).filter(item => item.id !== driver.id) })}><Trash2 size={13} /></button></div><div className="program-driver-fields"><label>主机<input value={driver.host || ''} onChange={event => updateDriver(index, { host: event.target.value })} placeholder="127.0.0.1" /></label><label>端口<input type="number" min={1} max={65535} value={driver.port || ''} onChange={event => updateDriver(index, { port: Number(event.target.value) || undefined })} /></label>{driver.type === 'serial-lan' && <label>波特率<input type="number" min={300} max={4000000} value={driver.baudRate || 115200} onChange={event => updateDriver(index, { baudRate: Number(event.target.value) || 115200 })} /></label>}<label>编码<select value={driver.encoding || 'utf8'} onChange={event => updateDriver(index, { encoding: event.target.value as ProgramDriver['encoding'] })}><option value="utf8">UTF-8</option><option value="base64">Base64</option></select></label></div><div className="program-driver-send"><input aria-label="发送数据" value={driverPayload[driver.id] || ''} onChange={event => setDriverPayload(current => ({ ...current, [driver.id]: event.target.value }))} placeholder="发送数据（用户确认连接后）" /><button onClick={() => void send(driver)} disabled={!connectedDrivers.includes(driver.id)}>发送</button></div><pre className="program-driver-buffer">{driverBuffers[driver.id] || '接收缓冲：客户端确认连接后，数据会流式显示在这里。'}</pre></article>)}{!(note.programDrivers || []).length && <p className="lab-help">先添加一个驱动，保存后由 Own 客户端展示连接安全提示。</p>}</section>
  </div>
}
