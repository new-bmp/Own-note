import { createHash } from 'node:crypto'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

const markdownParser = unified().use(remarkParse).use(remarkGfm).use(remarkMath)
const headingText = (node) =>
  node.value || node.children?.map(headingText).join('') || ''

// Slice the original source at top-level block boundaries. Never reserialize it:
// whitespace, code fences, tables and math must survive a round trip unchanged.
export function splitMarkdown(markdown) {
  const { children } = markdownParser.parse(markdown)
  // Reference definitions can affect any preceding block. Keep that document
  // together so reference links have the same meaning in its card preview.
  const hasReferences = children.some((node) =>
    ['definition', 'footnoteDefinition'].includes(node.type),
  )
  const starts = [0]
  if (!hasReferences) {
    for (const node of children) {
      const start = node.position.start.offset
      const length = start - starts.at(-1)
      if (
        starts.length < 64 &&
        length > 0 &&
        (length >= 3500 ||
          (node.type === 'heading' && node.depth <= 2 && length >= 160))
      ) starts.push(start)
    }
  }
  return starts.map((start, index) => {
    const end = starts[index + 1] ?? markdown.length
    const heading = children.find((node) =>
      node.type === 'heading' &&
      node.position.start.offset >= start &&
      node.position.start.offset < end,
    )
    return {
      title: (heading ? headingText(heading) : index ? `正文 · ${index + 1}` : '完整记录').slice(0, 200),
      markdown: markdown.slice(start, end),
    }
  })
}

export function sizeCard(card, width = 520) {
  card.width = width
  if (['markdown', 'text', 'checklist', 'table'].includes(card.kind)) {
    const lineWidth = Math.max(15, Math.floor((width - 48) / 14))
    const text = card.body || card.items?.map((item) => item.text).join('\n') || ''
    const lines = text.split('\n').reduce((sum, line) =>
      sum + Math.max(1, Math.ceil(line.length / lineWidth)), 0)
    const rows = card.rows?.length || 0
    card.height = Math.max(260, Math.min(760, 145 + Math.max(lines * 27, rows * 39)))
  }
  return card
}

export function placeCards(board, cards, overview = false) {
  const gap = 32
  const columnWidth = 520
  const startX = board.notes.length ? Math.min(...board.notes.map((note) => note.x)) : 0
  let y = board.notes.length ? Math.max(...board.notes.map((note) => note.y + note.height)) + 64 : 0
  let rest = cards
  if (overview && cards.length) {
    const first = sizeCard(cards[0], columnWidth * 2 + gap)
    first.x = startX
    first.y = y
    y += first.height + gap
    rest = cards.slice(1)
  }
  // Row order matches the reader and the saved noteIds. Repeated captures grow
  // downwards; existing user geometry is never rewritten.
  for (let index = 0; index < rest.length; index += 2) {
    const row = rest.slice(index, index + 2)
    row.forEach((card, column) => {
      sizeCard(card, columnWidth)
      card.x = startX + column * (columnWidth + gap)
      card.y = y
    })
    y += Math.max(...row.map((card) => card.height)) + gap
  }
  board.notes.push(...cards)
  board.updatedAt = Date.now()
}

function noteContent(note) {
  const keys = ['kind', 'title', 'body', 'caption', 'latex', 'mermaid', 'chart', 'items', 'columns', 'rows', 'url', 'filename']
  return Object.fromEntries(keys.filter((key) => note[key] !== undefined).map((key) => [key, note[key]]))
}
const digest = (note) => createHash('sha256').update(JSON.stringify(noteContent(note))).digest('hex')
export function captureContent(args, cards, markdownCards) {
  return {
    ...(args.markdown !== undefined ? { markdown: args.markdown, markdownNoteIds: markdownCards.map((card) => card.id) } : {}),
    received: {
      summaryCharacters: args.summary.length,
      markdownCharacters: args.markdown?.length || 0,
      sectionCharacters: args.sections.reduce((sum, section) => sum + section.markdown.length, 0),
      transcriptCharacters: args.transcript?.length || 0,
      sections: args.sections.length,
      decisions: args.decisions.length,
      actions: args.actions.length,
      openQuestions: args.openQuestions.length,
      references: args.references.length,
      equations: args.equations.length,
      diagrams: args.diagrams.length,
      charts: args.charts.length,
    },
    manifest: cards.map((note) => ({ id: note.id, contentHash: digest(note) })),
  }
}

export function conversationNotes(board, capture) {
  const byId = new Map(board.notes.map((note) => [note.id, note]))
  return capture.noteIds.flatMap((id) => byId.has(id) ? [byId.get(id)] : [])
}

export function verifyConversation(board, capture) {
  const notes = new Map(board.notes.map((note) => [note.id, note]))
  const content = capture.content
  const missingNoteIds = capture.noteIds.filter((id) => !notes.has(id))
  const changedNoteIds = content?.manifest.filter((entry) =>
    notes.has(entry.id) && digest(notes.get(entry.id)) !== entry.contentHash,
  ).map((entry) => entry.id) || []
  const warnings = []
  if (!content) warnings.push('这份旧记录没有保存核对清单；可读取现有卡片，无法校验最初提交的全部内容。')
  else if (!content.received.markdownCharacters && !content.received.sectionCharacters && !content.received.transcriptCharacters)
    warnings.push('没有收到详细正文，仅保存了摘要及已提供的结构化条目。需要完整整理时请提交 markdown 或 sections。')
  if (missingNoteIds.length) warnings.push('部分会话卡片已被删除，请核对缺失列表。')
  if (changedNoteIds.length) warnings.push('部分卡片在保存后有内容修改，当前内容与最初提交不同。')
  let markdown
  if (content?.markdown !== undefined) {
    const stored = content.markdownNoteIds.map((id) => notes.get(id)?.body || '').join('')
    markdown = {
      receivedCharacters: content.markdown.length,
      storedCharacters: stored.length,
      exactMatch: stored === content.markdown,
    }
  }
  return {
    scope: 'submitted_content',
    status: missingNoteIds.length ? 'incomplete' : changedNoteIds.length ? 'changed' : content ? 'verified' : 'untracked',
    received: content?.received || null,
    storedCards: capture.noteIds.length - missingNoteIds.length,
    expectedCards: capture.noteIds.length,
    ...(markdown ? { markdown } : {}),
    missingNoteIds,
    changedNoteIds,
    warnings,
  }
}
