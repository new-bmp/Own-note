import net from 'node:net'
import dgram from 'node:dgram'

const maxBuffer = 2 * 1024 * 1024
const validHost = value => typeof value === 'string' && value.length > 0 && value.length <= 255 && !/[\u0000-\u001f\u007f]/.test(value)

export function createProgramDrivers() {
  const connections = new Map()
  function append(connection, chunk) {
    const value = Buffer.from(chunk)
    connection.buffer = Buffer.concat([connection.buffer, value]).subarray(-maxBuffer)
    connection.events.push({ at: Date.now(), bytes: value.length, data: connection.encoding === 'base64' ? value.toString('base64') : value.toString('utf8') })
    connection.events = connection.events.slice(-1000)
  }
  async function connect(config) {
    if (!config || !['tcp', 'serial-lan', 'udp', 'websocket'].includes(config.type)) throw new Error('驱动类型不受支持。')
    if (config.type === 'websocket') {
      if (!validHost(config.host) || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('WebSocket 主机和端口无效。')
    } else if (!validHost(config.host) || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('驱动主机和端口无效。')
    await disconnect(config.id)
    const connection = { id: config.id, type: config.type, encoding: config.encoding || 'utf8', buffer: Buffer.alloc(0), events: [], status: 'connecting', socket: null }
    connections.set(config.id, connection)
    if (config.type === 'websocket') {
      if (typeof globalThis.WebSocket !== 'function') throw new Error('当前 Node.js 没有可用的 WebSocket 客户端。')
      const socket = new globalThis.WebSocket(`ws://${config.host}:${config.port}`)
      connection.socket = socket
      socket.addEventListener('message', event => append(connection, typeof event.data === 'string' ? Buffer.from(event.data) : event.data))
      socket.addEventListener('error', event => { connection.status = 'error'; connection.error = event.message || 'WebSocket 连接错误' })
      socket.addEventListener('close', () => { connection.status = 'closed' })
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('连接超时。')), 5000)
        socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
        socket.addEventListener('error', error => { clearTimeout(timer); reject(error) }, { once: true })
      })
      connection.status = 'connected'
    } else if (config.type === 'udp') {
      const socket = dgram.createSocket('udp4')
      connection.socket = socket
      socket.on('message', message => append(connection, message))
      socket.on('error', error => { connection.status = 'error'; connection.error = error.message })
      await new Promise((resolve, reject) => { socket.connect(config.port, config.host, error => error ? reject(error) : resolve()) })
      connection.status = 'connected'
    } else {
      const socket = net.createConnection({ host: config.host, port: config.port })
      connection.socket = socket
      socket.setNoDelay(true)
      socket.on('data', chunk => append(connection, chunk))
      socket.on('error', error => { connection.status = 'error'; connection.error = error.message })
      socket.on('close', () => { if (connection.status === 'connected') connection.status = 'closed' })
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('连接超时。')), 5000)
        socket.once('connect', () => { clearTimeout(timer); resolve() })
        socket.once('error', error => { clearTimeout(timer); reject(error) })
      })
      connection.status = 'connected'
    }
    return { id: connection.id, type: connection.type, status: connection.status }
  }
  async function disconnect(id) {
    const connection = connections.get(id)
    if (!connection) return { id, status: 'disconnected' }
    connections.delete(id)
    try { connection.socket?.close?.(); connection.socket?.destroy?.() } catch { /* closing an already closed socket */ }
    return { id, status: 'disconnected' }
  }
  function send(id, data, encoding = 'utf8') {
    const connection = connections.get(id)
    if (!connection || connection.status !== 'connected') throw new Error('驱动尚未连接或连接已关闭。')
    const value = encoding === 'base64' ? Buffer.from(data, 'base64') : Buffer.from(data, 'utf8')
    if (connection.type === 'udp' || connection.type === 'websocket') connection.socket.send(value)
    else connection.socket.write(value)
    return { id, bytes: value.length, status: connection.status }
  }
  function read(id, offset = 0, limit = 50) {
    const connection = connections.get(id)
    if (!connection) return { id, status: 'disconnected', events: [], nextOffset: null }
    const events = connection.events.slice(offset, offset + limit)
    return { id, status: connection.status, error: connection.error, events, nextOffset: offset + limit < connection.events.length ? offset + limit : null }
  }
  function status(id) { const connection = connections.get(id); return connection ? { id, status: connection.status, error: connection.error } : { id, status: 'disconnected' } }
  function close() { for (const id of connections.keys()) void disconnect(id) }
  return { connect, disconnect, send, read, status, close }
}
