import { z } from 'zod'
import { hash, checkProjectAction } from './project-policy.mjs'
import { id, target, addBase, codeCellSchema, executionSchema, programDriverSchema, programAnimationSchema } from './schemas.mjs'

const programKinds = new Set(['program', 'code'])
const driverPatchSchema = programDriverSchema.omit({ id: true })

function isProgram(note) { return !!note && programKinds.has(note.kind) && Array.isArray(note.cells) }

export function registerProgramTools({ tool, lab, programDrivers, readWorkspace, mutateWorkspace, getBoard, append, makeCard, readOnly, appendOnly }) {
  tool('own_add_program', '添加可编程块', '保存可编程单元、分步运行所需的输入输出、动画时间轴和 TCP/Serial over LAN 等驱动配置。保存本身不会执行代码或连接外部设备。', {
    ...addBase,
    cells: z.array(codeCellSchema).min(1).max(40),
    drivers: z.array(programDriverSchema.omit({ id: true })).max(32).optional(),
    programDrivers: z.array(programDriverSchema.omit({ id: true })).max(32).optional(),
    animation: programAnimationSchema.optional(),
  }, appendOnly, async args => append(args, makeCard('program', args.title, {
    width: 620,
    height: 560,
    body: args.caption,
    cells: args.cells.map(cell => ({ ...cell, id: crypto.randomUUID() })),
    programDrivers: (args.programDrivers || args.drivers || []).map(driver => ({ ...driver, id: crypto.randomUUID() })),
    animation: args.animation,
  })))

  tool('own_update_program', '更新可编程块', '先 own_read_note 获取 contentHash，再条件更新源码单元、驱动配置或动画。冲突时保留用户修改并要求重新读取。', {
    ...target,
    noteId: id,
    expectedHash: z.string().regex(/^[a-f0-9]{64}$/),
    title: z.string().trim().min(1).max(200).optional(),
    body: z.string().max(200000).optional(),
    cells: z.array(codeCellSchema.extend({ id })).min(1).max(40).optional(),
    drivers: z.array(programDriverSchema).max(32).optional(),
    programDrivers: z.array(programDriverSchema).max(32).optional(),
    animation: programAnimationSchema.optional(),
  }, { ...appendOnly, destructiveHint: true }, async args => mutateWorkspace(notebook => {
    const board = getBoard(notebook, args.boardId)
    const index = board.notes.findIndex(note => note.id === args.noteId)
    if (index < 0 || !isProgram(board.notes[index])) throw new Error('需要可编程块。')
    const previous = board.notes[index]
    if (hash(previous) !== args.expectedHash) throw new Error('可编程块已修改，请先 own_read_note。')
    checkProjectAction(notebook, board.id, 'notes', args.execution)
    const { boardId, projectId, noteId, expectedHash, execution, drivers, programDrivers, ...patch } = args
    const nextDrivers = programDrivers ?? drivers
    board.notes[index] = { ...previous, ...patch, ...(nextDrivers !== undefined ? { programDrivers: nextDrivers } : {}) }
    board.updatedAt = Date.now()
    return { notebook, result: { boardId: board.id, noteId, contentHash: hash(board.notes[index]), updated: Object.keys(patch) } }
  }))

  tool('own_configure_program_driver', '配置可编程块驱动', '保存 TCP、Serial over LAN、UDP 或 WebSocket 驱动参数。配置不会自动连接；连接前 Own 客户端必须展示目标地址、端口和数据方向并得到用户确认。', {
    ...target,
    noteId: id,
    expectedHash: z.string().regex(/^[a-f0-9]{64}$/),
    driverId: id.optional(),
    driver: driverPatchSchema,
  }, { ...appendOnly, destructiveHint: true }, async args => mutateWorkspace(notebook => {
    const board = getBoard(notebook, args.boardId), index = board.notes.findIndex(note => note.id === args.noteId)
    if (index < 0 || !isProgram(board.notes[index])) throw new Error('需要可编程块。')
    const previous = board.notes[index]
    if (hash(previous) !== args.expectedHash) throw new Error('可编程块已修改，请先 own_read_note。')
    const drivers = [...(previous.programDrivers || [])]
    const driver = { ...args.driver, id: args.driverId || crypto.randomUUID() }
    const at = drivers.findIndex(item => item.id === driver.id)
    if (at >= 0) drivers[at] = { ...drivers[at], ...driver }
    else drivers.push(driver)
    board.notes[index] = { ...previous, programDrivers: drivers }
    board.updatedAt = Date.now()
    return { notebook, result: { boardId: board.id, noteId: previous.id, driver, contentHash: hash(board.notes[index]), requiresUserApproval: true } }
  }))

  tool('own_set_program_animation', '设置可编程块动画', '保存关键帧动画。动画在 Own 客户端本地预览，保存和预览不会访问网络或执行外部代码。', {
    ...target,
    noteId: id,
    expectedHash: z.string().regex(/^[a-f0-9]{64}$/),
    animation: programAnimationSchema,
  }, { ...appendOnly, destructiveHint: true }, async args => mutateWorkspace(notebook => {
    const board = getBoard(notebook, args.boardId), index = board.notes.findIndex(note => note.id === args.noteId)
    if (index < 0 || !isProgram(board.notes[index])) throw new Error('需要可编程块。')
    const previous = board.notes[index]
    if (hash(previous) !== args.expectedHash) throw new Error('可编程块已修改，请先 own_read_note。')
    board.notes[index] = { ...previous, animation: args.animation }
    board.updatedAt = Date.now()
    return { notebook, result: { boardId: board.id, noteId: previous.id, contentHash: hash(board.notes[index]), frames: args.animation.frames.length } }
  }))

  const runSchema = { ...target, requestId: id, noteId: id, cellId: id, expectedHash: z.string().regex(/^[a-f0-9]{64}$/), execution: executionSchema.optional() }
  tool('own_run_program', '分步运行可编程块单元', '显式运行一个已保存的可编程单元，返回 jobId。用 own_program_result 轮询实时 stdout/stderr；结果只在源码、输入和版本仍匹配时写回。', runSchema, { ...appendOnly, destructiveHint: true, openWorldHint: true }, args => lab.start(args, 'code'))
  tool('own_start_program_debug', '开始可编程块调试', '开始可编程块的真实单步调试，之后用 own_program_result 查看变量和暂停位置，用 own_debug_command 控制下一步、断点、观察和停止。', { ...runSchema, breakpoints: z.array(z.number().int().min(1).max(10000)).max(100).optional(), watches: z.array(z.string().min(1).max(500)).max(20).optional() }, { ...appendOnly, destructiveHint: true, openWorldHint: true }, args => lab.start(args, 'debug'))
  tool('own_program_result', '读取可编程块运行状态', '读取程序运行的流式输出、退出码、调试暂停行、变量和是否已保存到笔记。', { jobId: id }, readOnly, args => lab.get(args.jobId))

  tool('own_connect_program_driver', '请求连接可编程块驱动', '提出连接 TCP、Serial over LAN、UDP 或 WebSocket 的请求。MCP 不会绕过 Own 客户端的安全确认；返回的目标地址需要先由用户确认。', { ...target, noteId: id, driverId: id }, { ...appendOnly, openWorldHint: true }, async args => {
    const { notebook } = await readWorkspace(), board = getBoard(notebook, args.boardId), note = board.notes.find(item => item.id === args.noteId), driver = note?.programDrivers?.find(item => item.id === args.driverId)
    if (!isProgram(note) || !driver) throw new Error('可编程块或驱动不存在，请先 own_read_note。')
    return { boardId: board.id, noteId: note.id, driver, status: 'awaiting-user-approval', requiresUserApproval: true, safety: '确认前请核对目标地址、端口和发送方向；不要连接不熟悉的设备。' }
  })
  tool('own_send_program_data', '向已确认驱动发送数据', '发送前需要用户在 Own 客户端批准并建立连接。MCP 请求本身不能打开任意网络连接，避免把凭证或敏感数据发送到错误地址。', { ...target, noteId: id, driverId: id, data: z.string().max(100000), encoding: z.enum(['utf8', 'base64']).default('utf8') }, { ...appendOnly, openWorldHint: true }, async args => {
    const { notebook } = await readWorkspace(), board = getBoard(notebook, args.boardId), note = board.notes.find(item => item.id === args.noteId)
    if (!isProgram(note) || !note.programDrivers?.some(driver => driver.id === args.driverId)) throw new Error('可编程块或驱动不存在，请先 own_read_note。')
    const status = programDrivers?.status(args.driverId)
    if (!status || status.status !== 'connected') return { status: 'awaiting-user-approval', requiresUserApproval: true, noteId: args.noteId, driverId: args.driverId, bytes: args.data.length, message: '请在 Own 客户端确认驱动连接后再发送。' }
    return { ...programDrivers.send(args.driverId, args.data, args.encoding), noteId: args.noteId, driverId: args.driverId }
  })
  tool('own_read_program_stream', '读取驱动接收缓冲', '读取 Own 客户端已接收的 Serial over LAN/TCP/UDP/WebSocket 数据。MCP 不会主动连接或读取未获用户确认的设备。', { ...target, noteId: id, driverId: id, offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(50).default(50) }, readOnly, async args => {
    const { notebook } = await readWorkspace(), board = getBoard(notebook, args.boardId), note = board.notes.find(item => item.id === args.noteId)
    if (!isProgram(note) || !note.programDrivers?.some(driver => driver.id === args.driverId)) throw new Error('可编程块或驱动不存在，请先 own_read_note。')
    const status = programDrivers?.status(args.driverId)
    if (!status || status.status !== 'connected') return { status: 'awaiting-user-approval', events: [], nextOffset: null, noteId: args.noteId, driverId: args.driverId, message: '驱动尚未由用户在客户端批准连接。' }
    return { ...programDrivers.read(args.driverId, args.offset, args.limit), noteId: args.noteId, driverId: args.driverId }
  })
}
