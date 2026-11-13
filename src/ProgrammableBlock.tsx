import { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, Plus, Radio, RefreshCw, Trash2 } from 'lucide-react'
import type { CanvasNote, ProgramAnimation, ProgramDriver, ProgramFrame } from './model'
import { uid } from './model'
import { CodeNotebook } from './CodeNotebook'

const animationDefault: ProgramAnimation = { width: 640, height: 360, durationMs: 3000, loop: true, frames: [{ at: 0, values: { x: 0, y: 0, opacity: 1 } }, { at: 3000, values: { x: 320, y: 180, opacity: 1 } }] }

function frameAt(animation: ProgramAnimation, time: number) {
  const ordered = [...animation.frames].sort((a, b) => a.at - b.at)
  return ordered.reduce<ProgramFrame | undefined>((current, frame) => frame.at <= time ? frame : current, ordered[0]) || { at: 0, values: {} }
}

export function ProgrammableBlock({ note, onChange, onBusy }: { note: CanvasNote; onChange: (patch: Partial<CanvasNote>) => void; onBusy: (busy: boolean) => void }) {
  const animation = note.animation || animationDefault
  const [playing, setPlaying] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [driverMessage, setDriverMessage] = useState('')
  const [connectedDrivers, setConnectedDrivers] = useState<string[]>([])
  const [driverBuffers, setDriverBuffers] = useState<Record<string, string>>({})
  const [driverPayload, setDriverPayload] = useState<Record<string, string>>({})
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
  function updateAnimation(patch: Partial<ProgramAnimation>) { onChange({ animation: { ...animation, ...patch } }) }
  function updateFrame(index: number, patch: Partial<ProgramFrame>) { updateAnimation({ frames: animation.frames.map((item, i) => i === index ? { ...item, ...patch } : item) }) }
  function addFrame() {
    const at = Math.min(animation.durationMs, Math.round(elapsed))
    updateAnimation({ frames: [...animation.frames, { at, values: { x: 0, y: 0, opacity: 1 } }] })
  }
  function updateDriver(index: number, patch: Partial<ProgramDriver>) { onChange({ programDrivers: (note.programDrivers || []).map((driver, i) => i === index ? { ...driver, ...patch } : driver) }) }
  function addDriver() { onChange({ programDrivers: [...(note.programDrivers || []), { id: uid(), name: '新驱动', type: 'tcp', host: '127.0.0.1', port: 4000, encoding: 'utf8', enabled: true }] }) }
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
    <section className="program-section program-animation"><header className="program-section-heading"><div><strong>动画制作器</strong><span>关键帧在本机预览，不会自动连接外部设备</span></div><div className="program-toolbar"><button onClick={() => { if (playing) setPlaying(false); else { startedAt.current = 0; setPlaying(true) } }}>{playing ? <Pause size={14} /> : <Play size={14} />}{playing ? '暂停' : '预览'}</button><button onClick={addFrame}><Plus size={14} />关键帧</button></div></header>
      <div className="program-animation-stage" style={{ aspectRatio: `${animation.width} / ${animation.height}` }}><div className="program-animation-object" style={{ transform: `translate(${x}px, ${y}px)`, opacity }} /><span className="program-animation-time">{Math.round(elapsed)} / {animation.durationMs} ms</span></div>
      <div className="program-animation-controls"><label>时长 <input type="number" min={100} max={86400000} value={animation.durationMs} onChange={event => updateAnimation({ durationMs: Math.max(100, Number(event.target.value) || 100) })} /></label><label className="lab-checkbox"><input type="checkbox" checked={animation.loop} onChange={event => updateAnimation({ loop: event.target.checked })} />循环</label><input aria-label="动画时间轴" type="range" min={0} max={animation.durationMs} value={Math.min(animation.durationMs, elapsed)} onChange={event => { setPlaying(false); setElapsed(Number(event.target.value)) }} /></div>
      <div className="program-keyframes">{animation.frames.map((item, index) => <div className="program-keyframe" key={`${index}-${item.at}`}><label>时间<input type="number" min={0} max={animation.durationMs} value={item.at} onChange={event => updateFrame(index, { at: Math.max(0, Math.min(animation.durationMs, Number(event.target.value) || 0)) })} /></label><label>变量 JSON<textarea value={JSON.stringify(item.values)} onChange={event => { try { const values = JSON.parse(event.target.value); if (values && typeof values === 'object' && !Array.isArray(values)) updateFrame(index, { values }) } catch { /* keep the last valid keyframe while editing */ } }} /></label><button aria-label={`删除第 ${index + 1} 个关键帧`} onClick={() => updateAnimation({ frames: animation.frames.filter((_, i) => i !== index) })} disabled={animation.frames.length <= 1}><Trash2 size={14} /></button></div>)}</div>
    </section>
    <section className="program-section program-drivers"><header className="program-section-heading"><div><strong>设备与网络驱动</strong><span>TCP、Serial over LAN、UDP、WebSocket</span></div><button onClick={addDriver}><Plus size={14} />添加驱动</button></header>{driverMessage && <p className="lab-help" role="status">{driverMessage}</p>}{(note.programDrivers || []).map((driver, index) => <article className="program-driver" key={driver.id}><div className="program-driver-title"><Radio size={15} /><input value={driver.name || ''} aria-label="驱动名称" onChange={event => updateDriver(index, { name: event.target.value })} /><select value={driver.type} aria-label="驱动类型" onChange={event => updateDriver(index, { type: event.target.value as ProgramDriver['type'] })}><option value="tcp">TCP</option><option value="serial-lan">Serial over LAN</option><option value="udp">UDP</option><option value="websocket">WebSocket</option></select><button onClick={() => void connect(driver)}><RefreshCw size={13} />连接</button><button aria-label="删除驱动" onClick={() => onChange({ programDrivers: (note.programDrivers || []).filter(item => item.id !== driver.id) })}><Trash2 size={13} /></button></div><div className="program-driver-fields"><label>主机<input value={driver.host || ''} onChange={event => updateDriver(index, { host: event.target.value })} placeholder="127.0.0.1" /></label><label>端口<input type="number" min={1} max={65535} value={driver.port || ''} onChange={event => updateDriver(index, { port: Number(event.target.value) || undefined })} /></label>{driver.type === 'serial-lan' && <label>波特率<input type="number" min={300} max={4000000} value={driver.baudRate || 115200} onChange={event => updateDriver(index, { baudRate: Number(event.target.value) || 115200 })} /></label>}<label>编码<select value={driver.encoding || 'utf8'} onChange={event => updateDriver(index, { encoding: event.target.value as ProgramDriver['encoding'] })}><option value="utf8">UTF-8</option><option value="base64">Base64</option></select></label></div><div className="program-driver-send"><input aria-label="发送数据" value={driverPayload[driver.id] || ''} onChange={event => setDriverPayload(current => ({ ...current, [driver.id]: event.target.value }))} placeholder="发送数据（用户确认连接后）" /><button onClick={() => void send(driver)} disabled={!connectedDrivers.includes(driver.id)}>发送</button></div><pre className="program-driver-buffer">{driverBuffers[driver.id] || '接收缓冲：客户端确认连接后，数据会流式显示在这里。'}</pre></article>)}{!(note.programDrivers || []).length && <p className="lab-help">先添加一个驱动，保存后由 Own 客户端展示连接安全提示。</p>}</section>
  </div>
}
