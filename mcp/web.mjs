import { z } from 'zod'
import { hash } from './project-policy.mjs'
import { id, target, addBase } from './schemas.mjs'

const webUrl = z.string().url().refine(value => /^https?:\/\//.test(value), '网页链接只支持 http 或 https。')

export function registerWebTools({ tool, readWorkspace, mutateWorkspace, getBoard, append, makeCard, readOnly, appendOnly, boardUrl }) {
  tool('own_add_web_link', '添加网页链接', '保存网页预览或交互请求。interactive 只提出请求，用户必须在 Own 客户端阅读安全提示并确认后才会嵌入网页；MCP 永远不能代为批准。', {
    ...addBase,
    url: webUrl,
    mode: z.enum(['preview', 'interactive']).default('preview'),
  }, appendOnly, async args => {
    const parsed = new URL(args.url)
    const result = await append(args, makeCard('link', args.title, {
      url: parsed.href,
      body: parsed.hostname.toUpperCase(),
      caption: args.caption,
      webInteraction: { mode: args.mode },
    }))
    return { ...result, mode: args.mode, requiresUserApproval: args.mode === 'interactive', safety: '请勿在嵌入网页中输入密码、令牌或银行卡信息；部分网站会禁止 iframe。' }
  })

  tool('own_set_web_link_mode', '切换网页预览或交互模式', '按 contentHash 修改网页卡片的模式。切换到 interactive 不会批准交互；用户必须在客户端确认来源后才会保存 approvedOrigin。', {
    ...target,
    noteId: id,
    expectedHash: z.string().regex(/^[a-f0-9]{64}$/),
    mode: z.enum(['preview', 'interactive']),
  }, { ...appendOnly, destructiveHint: true }, async args => mutateWorkspace(notebook => {
    const board = getBoard(notebook, args.boardId)
    const index = board.notes.findIndex(note => note.id === args.noteId)
    if (index < 0 || board.notes[index].kind !== 'link') throw new Error('需要网页链接卡片。')
    const previous = board.notes[index]
    if (hash(previous) !== args.expectedHash) throw new Error('网页卡片已修改，请先 own_read_web_link。')
    const current = previous.webInteraction || { mode: 'preview' }
    const origin = new URL(previous.url || '').origin
    board.notes[index] = {
      ...previous,
      webInteraction: args.mode === 'interactive'
        ? { mode: args.mode, ...(current.approvedOrigin === origin ? { approvedOrigin: origin, approvedAt: current.approvedAt } : {}) }
        : { mode: 'preview' },
    }
    board.updatedAt = Date.now()
    return { notebook, result: { boardId: board.id, noteId: previous.id, contentHash: hash(board.notes[index]), mode: args.mode, requiresUserApproval: args.mode === 'interactive', url: boardUrl(board.id, previous.id) } }
  }))

  tool('own_read_web_link', '读取网页链接安全状态', '读取 URL、来源、预览/交互模式和用户批准状态。批准时间只表示用户在客户端看到安全提示后确认过，不代表目标网站允许嵌入。', { ...target, noteId: id }, readOnly, async args => {
    const { notebook } = await readWorkspace()
    const board = getBoard(notebook, args.boardId)
    const note = board.notes.find(item => item.id === args.noteId)
    if (!note || note.kind !== 'link') throw new Error('需要网页链接卡片。')
    const origin = note.url ? new URL(note.url).origin : ''
    return {
      boardId: board.id,
      noteId: note.id,
      title: note.title,
      url: note.url,
      origin,
      mode: note.webInteraction?.mode || 'preview',
      approved: !!note.webInteraction?.approvedOrigin && note.webInteraction.approvedOrigin === origin,
      approvedOrigin: note.webInteraction?.approvedOrigin,
      approvedAt: note.webInteraction?.approvedAt,
      requiresUserApproval: note.webInteraction?.mode === 'interactive' && note.webInteraction?.approvedOrigin !== origin,
      contentHash: hash(note),
      urlInOwn: boardUrl(board.id, note.id),
    }
  })
}
