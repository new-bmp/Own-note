import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createFieldnotesServer } from '../server.mjs'
import { initialNotebook } from '../src/model.ts'

async function fixture(t, empty = false) {
  const directory = await mkdtemp(path.join(tmpdir(), 'own-mcp-'))
  const server = await createFieldnotesServer({ dataDir: directory })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const url = `http://127.0.0.1:${server.address().port}`
  const clients = []
  t.after(async () => {
    await Promise.all(clients.map((client) => client.close()))
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()))
    assert.ok(path.basename(directory).startsWith('own-mcp-'))
    await rm(directory, { recursive: true, force: true })
  })
  const request = (route, options) => fetch(url + route, options)
  if (!empty) {
    const response = await request('/api/notebook')
    assert.equal(
      (
        await request('/api/notebook', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'If-Match': response.headers.get('etag'),
          },
          body: JSON.stringify(initialNotebook()),
        })
      ).status,
      200,
    )
  }
  const connect = async (transport) => {
    const client = new Client({
      name: 'own-integration-test',
      version: '1.0.0',
    })
    clients.push(client)
    await client.connect(
      transport || new StreamableHTTPClientTransport(new URL(url + '/mcp')),
    )
    return client
  }
  const client = await connect()
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args })
    assert.ok(!result.isError, JSON.stringify(result.content))
    return result.structuredContent
  }
  return {
    client,
    call,
    request,
    url,
    directory,
    connect,
    notebook: async () =>
      (await (await request('/api/notebook')).json()).notebook,
  }
}

const capture = () => ({
  requestId: 'conversation-001',
  title: 'Own 的会话整理设计',
  summary:
    '目标是把 agent 会话转换为便于阅读和执行的笔记。已明确使用 Node.js，并增加公式和图。',
  sections: [
    {
      title: '背景与需求',
      markdown: '用户需要**自由画布**，把文字、表格、照片和文件放在一起。',
    },
  ],
  decisions: [
    {
      decision: '采用 MCP 连接当前 agent 与 Own',
      reason: '复用会话中的已知信息，保持可追溯性。',
    },
  ],
  actions: [{ text: '验证一次真实写入', owner: '开发者', priority: 'high' }],
  openQuestions: ['是否需要多人协作？'],
  references: [{ title: 'MCP 规范', url: 'https://modelcontextprotocol.io/' }],
  equations: [
    {
      title: '任务完成率',
      latex: 'P = \\frac{n}{N}',
      explanation: 'n 是已完成数，N 是总数且大于零。',
    },
  ],
  diagrams: [
    {
      title: '整理流程',
      mermaid: 'flowchart LR\n A[会话] --> B[摘要]\n B --> C[行动]',
    },
  ],
  charts: [
    {
      title: '示例值',
      chart: {
        type: 'bar',
        labels: ['甲', '乙'],
        series: [{ name: '示例', values: [2, 3] }],
      },
      caption: '仅用于测试。',
    },
  ],
  source: { agent: '测试 agent', conversationId: 'test-conversation' },
})

test('MCP initializes over HTTP and exposes tools, resources, templates and an organizing prompt', async (t) => {
  const app = await fixture(t)
  const tools = await app.client.listTools()
  assert.equal(tools.tools.length, 10)
  assert.ok(
    tools.tools.some(
      (tool) =>
        tool.name === 'own_save_conversation' &&
        tool.inputSchema.properties.summary,
    ),
  )
  assert.ok(
    (await app.client.listResources()).resources.some(
      (resource) => resource.uri === 'own://guide',
    ),
  )
  assert.equal(
    (await app.client.listResourceTemplates()).resourceTemplates[0].uriTemplate,
    'own://boards/{boardId}',
  )
  assert.match(
    (await app.client.readResource({ uri: 'own://guide' })).contents[0].text,
    /不编造/,
  )
  assert.equal(
    (await app.client.listPrompts()).prompts[0].name,
    'organize_conversation',
  )
  assert.match(
    (
      await app.client.getPrompt({
        name: 'organize_conversation',
        arguments: { focus: '下一步行动' },
      })
    ).messages[0].content.text,
    /下一步行动/,
  )
  const integration = await (await app.request('/api/integrations')).json()
  assert.equal(integration.url, app.url + '/mcp')
  assert.ok(path.isAbsolute(integration.stdio.args[0]))
})

test('conversation capture atomically persists readable cards, provenance and idempotency across clients', async (t) => {
  const app = await fixture(t, true)
  const args = capture()
  const saved = await app.call('own_save_conversation', args)
  assert.equal(saved.duplicate, false)
  assert.equal(saved.noteIds.length, 9)
  assert.ok(saved.boardUrl.includes('?board='))
  const notebook = await app.notebook(),
    board = notebook.boards[0]
  assert.equal(
    board.notes.find((note) => note.kind === 'checklist').items[0].owner,
    '开发者',
  )
  assert.ok(board.notes.every((note) => note.source.agent === '测试 agent'))
  assert.equal(board.captures[0].summary, args.summary)
  assert.deepEqual(
    JSON.parse(
      await readFile(path.join(app.directory, 'notebook.json'), 'utf8'),
    ),
    notebook,
  )
  const second = await app.connect()
  const retried = await second.callTool({
    name: 'own_save_conversation',
    arguments: args,
  })
  assert.equal(retried.structuredContent.duplicate, true)
  assert.deepEqual(await app.notebook(), notebook)
  const conflicting = await app.client.callTool({
    name: 'own_save_conversation',
    arguments: { ...args, summary: '不同内容' },
  })
  assert.equal(conflicting.isError, true)
  assert.deepEqual(await app.notebook(), notebook)
})

test('full Markdown survives block splitting, paginated readback and reopening without truncation', async (t) => {
  const app = await fixture(t, true)
  const code = '```js\r\nconst heading = "## 代码中的标题不是章节"\r\n' + '// 保留代码和空格  \r\n'.repeat(400) + '```'
  const table = '| 项目 | 数值 |\r\n| --- | ---: |\r\n' + Array.from({ length: 80 }, (_, i) => `| 指标${i} | ${i} |`).join('\r\n')
  const math = '$$\r\nP = \\frac{n}{N} \\times 100\\%\r\n$$'
  const markdown = '\r\n# 完整工作记录 📝\r\n\r\n' +
    '目标与用户约束，均需保留。'.repeat(50) + '\r\n\r\n## 实现过程\r\n\r\n' + code +
    '\r\n\r\n## 数据与验证\r\n\r\n' + table + '\r\n\r\n' + math +
    '\r\n\r\n## 未完成事项\r\n\r\n' + '保留失败原因及下一步。\r\n\r\n'.repeat(300) + '全文结束标记：END-完整-2026  \r\n'
  const args = {
    requestId: 'full-document', title: '完整会话', summary: '完整整理正文，包含代码、表格、公式和未完成事项。', markdown,
    actions: [{ text: '核对全部内容及末尾标记', owner: '小林', done: true, dueDate: '2026-11-12' }],
  }
  const saved = await app.call('own_save_conversation', args)
  assert.equal(saved.verification.status, 'verified')
  assert.deepEqual(saved.verification.markdown, { receivedCharacters: markdown.length, storedCharacters: markdown.length, exactMatch: true })
  assert.equal(saved.verification.received.actions, 1)
  assert.deepEqual(saved.verification.warnings, [])
  const board = (await app.notebook()).boards[0]
  const ids = board.captures[0].content.markdownNoteIds
  const bodies = ids.map((id) => board.notes.find((note) => note.id === id).body)
  assert.ok(bodies.length >= 4)
  assert.equal(bodies.join(''), markdown)
  for (const block of [code, table, math]) assert.ok(bodies.some((body) => body.includes(block)), 'must not cut a Markdown block')
  assert.ok(bodies.at(-1).endsWith('全文结束标记：END-完整-2026  \r\n'))
  const read = []
  let offset = 0
  do {
    const page = await app.call('own_read_conversation', { requestId: args.requestId, offset, limit: 2 })
    read.push(...page.notes)
    offset = page.nextOffset
  } while (offset !== null)
  assert.deepEqual(read.map((note) => note.id), saved.noteIds)
  assert.equal(read.find((note) => note.kind === 'checklist').items[0].text, args.actions[0].text)
  assert.equal((await app.call('own_read_board', { boardId: board.id })).captures[0].content, undefined)
  const retry = await app.call('own_save_conversation', args)
  assert.equal(retry.duplicate, true)
  assert.deepEqual(retry.verification, saved.verification)

  const reopened = await createFieldnotesServer({ dataDir: app.directory })
  reopened.listen(0, '127.0.0.1')
  await once(reopened, 'listening')
  t.after(async () => {
    reopened.closeAllConnections()
    await new Promise((resolve) => reopened.close(resolve))
  })
  const client = await app.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${reopened.address().port}/mcp`)))
  const restored = (await client.callTool({ name: 'own_read_conversation', arguments: { requestId: args.requestId, includeOriginal: true } })).structuredContent
  assert.equal(restored.originalMarkdown, markdown)
  assert.equal(restored.verification.status, 'verified')
  assert.equal(restored.verification.markdown.exactMatch, true)
})

test('readback distinguishes omitted details, user edits and deleted cards from a complete save', async (t) => {
  const app = await fixture(t, true)
  const short = await app.call('own_save_conversation', { requestId: 'short', title: '仅摘要', summary: '用户只提交了摘要。' })
  assert.equal(short.verification.received.markdownCharacters, 0)
  assert.match(short.verification.warnings.join(''), /没有收到详细正文/)
  const args = { requestId: 'verified', title: '完整正文', summary: '导读。', markdown: '## 记录\n\n原始完整正文及末尾标记。' }
  const saved = await app.call('own_save_conversation', args)
  const page = await app.call('own_read_conversation', { requestId: args.requestId })
  const note = page.notes[1]
  await app.call('own_update_note', { boardId: saved.boardId, noteId: note.id, expectedHash: note.contentHash, body: '用户修改后的内容。' })
  const changed = await app.call('own_read_conversation', { requestId: args.requestId, includeOriginal: true })
  assert.equal(changed.verification.status, 'changed')
  assert.deepEqual(changed.verification.changedNoteIds, [note.id])
  assert.equal(changed.originalMarkdown, args.markdown)
  assert.equal(changed.verification.markdown.exactMatch, false)
  const current = await app.request('/api/notebook')
  const notebook = (await current.json()).notebook
  const board = notebook.boards.find((board) => board.id === saved.boardId)
  board.notes = board.notes.filter((entry) => entry.id !== note.id)
  assert.equal((await app.request('/api/notebook', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': current.headers.get('etag') }, body: JSON.stringify(notebook) })).status, 200)
  const retry = await app.call('own_save_conversation', args)
  assert.equal(retry.duplicate, true)
  assert.equal(retry.verification.status, 'incomplete')
  assert.deepEqual(retry.verification.missingNoteIds, [note.id])
  assert.equal(retry.verification.storedCards, retry.verification.expectedCards - 1)
  assert.equal((await app.notebook()).boards.find((board) => board.id === saved.boardId).notes.length, 1)
  const before = await app.notebook()
  const oversized = await app.client.callTool({ name: 'own_save_conversation', arguments: { ...args, requestId: 'oversized', markdown: '长'.repeat(200001) } })
  assert.equal(oversized.isError, true)
  assert.deepEqual(await app.notebook(), before)
})

test('capture layout follows reading order, stays within two columns and preserves earlier placements', async (t) => {
  const app = await fixture(t, true)
  let boardId
  let earlier = []
  let bottom = -64
  for (let index = 0; index < 3; index++) {
    const saved = await app.call('own_save_conversation', { ...capture(), boardId, requestId: `layout-${index}` })
    boardId = saved.boardId
    const board = (await app.notebook()).boards[0]
    assert.deepEqual(board.notes.slice(0, earlier.length), earlier)
    const added = board.notes.slice(earlier.length)
    assert.ok(added[0].y >= bottom + 64)
    assert.equal(added[0].width, 1072)
    assert.equal(Math.max(...added.map((note) => note.x + note.width)) - Math.min(...added.map((note) => note.x)), 1072)
    assert.deepEqual([...added].sort((a, b) => a.y - b.y || a.x - b.x).map((note) => note.id), saved.noteIds)
    for (const a of board.notes) for (const b of board.notes) {
      if (a.id === b.id) continue
      assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y)
    }
    bottom = Math.max(...board.notes.map((note) => note.y + note.height))
    earlier = board.notes
  }
})

test('reference-style links retain their definitions and Markdown meaning', async (t) => {
  const app = await fixture(t, true)
  const markdown = '## 参考\n\n详见 [规范][mcp]。\n\n' + '背景内容。'.repeat(1200) + '\n\n## 后续\n\n链接应仍可打开。\n\n[mcp]: https://modelcontextprotocol.io/ "MCP"\n'
  const saved = await app.call('own_save_conversation', { requestId: 'references', title: '引用链接', summary: '保留引用语义。', markdown })
  const page = await app.call('own_read_conversation', { requestId: saved.requestId })
  assert.equal(page.notes.length, 2)
  assert.equal(page.notes[1].body, markdown)
  assert.equal(saved.verification.markdown.exactMatch, true)
})

test('appending captures and rich cards preserves user content and placements', async (t) => {
  const app = await fixture(t)
  const before = await app.notebook(),
    board = before.boards[0]
  await app.call('own_save_conversation', { ...capture(), boardId: board.id })
  const first = await app.call('own_add_latex', {
    boardId: board.id,
    requestId: 'formula-1',
    title: '求和',
    latex: '\\sum_{i=1}^{n} i',
    caption: '前 n 个正整数之和。',
  })
  const duplicate = await app.call('own_add_latex', {
    boardId: board.id,
    requestId: 'formula-1',
    title: '求和',
    latex: '\\sum_{i=1}^{n} i',
    caption: '前 n 个正整数之和。',
  })
  assert.equal(duplicate.duplicate, true)
  assert.deepEqual(first.noteIds, duplicate.noteIds)
  await app.call('own_add_diagram', {
    boardId: board.id,
    requestId: 'diagram-1',
    title: '时序',
    mermaid: 'sequenceDiagram\n User->>Agent: 整理\n Agent->>Own: 保存',
  })
  await app.call('own_add_chart', {
    boardId: board.id,
    requestId: 'chart-1',
    title: '趋势',
    chart: {
      type: 'line',
      labels: ['周一', '周二'],
      series: [{ name: '完成', values: [1, 3] }],
      unit: '项',
    },
  })
  const after = (await app.notebook()).boards[0]
  assert.deepEqual(after.notes.slice(0, board.notes.length), board.notes)
  assert.deepEqual(
    after.connections.slice(0, board.connections.length),
    board.connections,
  )
  assert.equal(after.notes.length, board.notes.length + 12)
})

test('invalid formulas, diagrams and numerical chart data never partially mutate a board', async (t) => {
  const app = await fixture(t),
    before = await app.notebook(),
    boardId = before.boards[0].id
  for (const [name, args] of [
    ['own_add_latex', { latex: '\\frac{' }],
    ['own_add_diagram', { mermaid: 'flowchart LR\n A -->' }],
    [
      'own_add_diagram',
      { mermaid: 'flowchart LR\n A-->B\n click A "https://example.com"' },
    ],
    [
      'own_add_chart',
      {
        chart: {
          type: 'bar',
          labels: ['A', 'B'],
          series: [{ name: 'values', values: [3] }],
        },
      },
    ],
    [
      'own_add_chart',
      {
        chart: {
          type: 'pie',
          labels: ['A'],
          series: [{ name: 'values', values: [-3] }],
        },
      },
    ],
  ]) {
    assert.equal(
      (
        await app.client.callTool({
          name,
          arguments: { boardId, requestId: 'invalid', title: '无效', ...args },
        })
      ).isError,
      true,
    )
    assert.deepEqual(await app.notebook(), before)
  }
  const broken = capture()
  broken.equations.push({ title: '无效公式', latex: '\\badcommand' })
  assert.equal(
    (
      await app.client.callTool({
        name: 'own_save_conversation',
        arguments: broken,
      })
    ).isError,
    true,
  )
  assert.deepEqual(await app.notebook(), before)
})

test('search and optimistic card updates protect edits and retain geometry and provenance', async (t) => {
  const app = await fixture(t),
    saved = await app.call('own_save_conversation', capture())
  const found = await app.call('own_search', { query: '自由画布' })
  assert.equal(found.total, 1)
  const board = await app.call('own_read_board', { boardId: saved.boardId }),
    note = board.notes[0]
  const updated = await app.call('own_update_note', {
    boardId: board.id,
    noteId: note.id,
    expectedHash: note.contentHash,
    title: '更新后的会话摘要',
  })
  assert.notEqual(updated.preview[0].contentHash, note.contentHash)
  const stale = await app.client.callTool({
    name: 'own_update_note',
    arguments: {
      boardId: board.id,
      noteId: note.id,
      expectedHash: note.contentHash,
      body: '不应覆盖',
    },
  })
  assert.equal(stale.isError, true)
  const actual = (await app.notebook()).boards.find(
    (board) => board.id === saved.boardId,
  ).notes[0]
  assert.equal(actual.title, '更新后的会话摘要')
  for (const key of ['x', 'y', 'width', 'height', 'source'])
    assert.deepEqual(actual[key], note[key])
})

test('browser ETags and concurrent MCP writes share one serialization queue', async (t) => {
  const app = await fixture(t),
    old = await app.request('/api/notebook'),
    before = (await old.json()).notebook,
    boardId = before.boards[0].id
  await Promise.all(
    ['one', 'two', 'three'].map((requestId) =>
      app.call('own_add_note', {
        boardId,
        requestId,
        title: requestId,
        body: `并发写入 ${requestId}`,
      }),
    ),
  )
  const staleSave = await app.request('/api/notebook', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'If-Match': old.headers.get('etag'),
    },
    body: JSON.stringify(before),
  })
  assert.equal(staleSave.status, 409)
  assert.equal(
    (await app.notebook()).boards[0].notes.length,
    before.boards[0].notes.length + 3,
  )
  const fresh = await app.request('/api/notebook')
  assert.equal(
    (
      await app.request('/api/notebook', {
        headers: { 'If-None-Match': fresh.headers.get('etag') },
      })
    ).status,
    304,
  )
  assert.equal(
    (
      await app.request('/mcp', {
        method: 'POST',
        headers: {
          Origin: 'https://unrelated.example',
          'Content-Type': 'application/json',
        },
        body: '{}',
      })
    ).status,
    403,
  )
})

test('stdio bridge exposes the same tools and persists through the running HTTP server', async (t) => {
  const app = await fixture(t)
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve('mcp-stdio.mjs')],
    env: { ...process.env, OWN_URL: app.url },
    stderr: 'pipe',
  })
  let errors = ''
  transport.stderr.on('data', (data) => {
    errors += data.toString()
  })
  const client = await app.connect(transport)
  assert.equal((await client.listTools()).tools.length, 10, errors)
  const response = await client.callTool({
    name: 'own_save_conversation',
    arguments: {
      requestId: 'stdio-1',
      title: 'stdio 整理',
      summary: '通过 stdio 连接同一个 Own 工作空间。',
    },
  })
  assert.ok(!response.isError, JSON.stringify(response.content))
  assert.ok(
    (await app.notebook()).boards.some((board) => board.title === 'stdio 整理'),
  )
  assert.match(
    (await client.readResource({ uri: 'own://guide' })).contents[0].text,
    /会话整理/,
  )
})
