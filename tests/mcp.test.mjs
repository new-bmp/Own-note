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
import { restoreAgentActivity, conceptDependencyError } from '../shared/concepts.js'

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
  assert.equal(tools.tools.length, 18)
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

async function editWorkspace(app, change) {
  const response = await app.request('/api/notebook'), { notebook } = await response.json()
  change(notebook)
  const saved = await app.request('/api/notebook', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': response.headers.get('etag') }, body: JSON.stringify(notebook) })
  assert.equal(saved.status, 200, await saved.text())
}
const plan = boardId => ({
  boardId, requestId: 'plan-1', agentId: 'agent-a', agentName: '开发 Agent', title: '公开实现方案', markdown: '## 目标\n\n先实现，再验证。',
  tasks: [
    { id: 'implement', title: '实现功能', markdown: '按用户要求实现功能。', acceptance: '保留用户指定内容。', dependsOn: [] },
    { id: 'verify', title: '验证效果', markdown: '验证输入与输出。', acceptance: '给出真实验证证据。', dependsOn: ['implement'] },
  ],
})
const report = (boardId, lease, patch = {}) => ({ boardId, agentId: 'agent-a', noteId: lease.note.id, revision: lease.revision, leaseToken: lease.leaseToken, status: 'running', progress: '准备执行。', ...patch })

test('independent Agent projects can be discovered, created idempotently and used without a canvas ID',async t=>{
  const app=await fixture(t),before=(await app.notebook()).boards
  const created=await app.call('own_create_agent_project',{requestId:'independent',title:'独立代码学习',description:'公开实现过程'})
  assert.equal((await app.call('own_create_agent_project',{requestId:'independent',title:'不会覆盖用户项目名'})).duplicate,true)
  const list=await app.call('own_list_agent_projects',{query:'代码学习'})
  assert.equal(list.projects.length,1);assert.equal(list.projects[0].projectId,created.projectId)
  const args=plan(undefined);delete args.boardId;args.projectId=created.projectId
  await app.call('own_publish_plan',args)
  const lease=await app.call('own_agent_next',{projectId:created.projectId,agentId:'agent-a'})
  assert.equal(lease.status,'running')
  const reported=await app.call('own_agent_report',{...report(undefined,lease,{status:'done',evidence:'真实验证记录'}),projectId:created.projectId})
  assert.equal(reported.accepted,true)
  const code=await app.call('own_add_code',{boardId:created.projectId,requestId:'project-code',title:'实现代码',cells:[{language:'python',code:'print(8)',stdin:''}]})
  const read=await app.call('own_read_board',{boardId:created.projectId})
  assert.ok(read.notes.some(n=>n.id===code.noteIds[0]))
  const found=await app.call('own_search',{query:'实现代码'})
  assert.ok(found.results.some(n=>n.boardId===created.projectId))
  assert.deepEqual((await app.notebook()).boards,before,'project operations leave the canvas intact')
})

test('Agent plan leases follow edited notes, reject stale completion and unlock dependent work only after evidence', async t => {
  const app = await fixture(t), boardId = (await app.notebook()).boards[0].id
  const published = await app.call('own_publish_plan', plan(boardId))
  assert.equal(published.tasks.length, 2); assert.ok(published.overviewId)
  const first = await app.call('own_agent_next', { boardId, agentId: 'agent-a' })
  assert.equal(first.note.title, '实现功能'); assert.equal(first.note.concept.status, 'running')
  const other = await app.call('own_agent_next', { boardId, agentId: 'agent-b' })
  assert.equal(other.status, 'waiting', 'a second Agent cannot take an active task or its dependency')
  assert.equal((await app.call('own_agent_report', report(boardId, first, { progress: '已检查输入。' }))).accepted, true)
  assert.ok(!(await app.notebook()).boards[0].notes.some(n=>n.id===first.note.id),'Agent tasks stay outside the canvas')
  assert.match(published.projectUrl,/mode=agents/)
  await editWorkspace(app, notebook => { notebook.agentProjects[0].notes.find(n => n.id === first.note.id).body = '新要求：必须输出中文，并保留原始数据。' })
  const rejected = await app.call('own_agent_report', report(boardId, first, { status: 'done', evidence: '旧版本结果。' }))
  assert.equal(rejected.accepted, false); assert.equal(rejected.needsReplan, true)
  assert.equal(rejected.note.body, '新要求：必须输出中文，并保留原始数据。')
  const duplicate = await app.call('own_publish_plan', plan(boardId))
  assert.equal(duplicate.duplicate, true); assert.equal(duplicate.tasks.find(n => n.id === first.note.id).body, rejected.note.body)
  const next = await app.call('own_agent_next', { boardId, agentId: 'agent-a' })
  assert.notEqual(next.leaseToken, first.leaseToken); assert.notEqual(next.revision, first.revision)
  const noEvidence = await app.client.callTool({ name: 'own_agent_report', arguments: report(boardId, next, { status: 'done' }) })
  assert.equal(noEvidence.isError, true)
  const done = await app.call('own_agent_report', report(boardId, next, { status: 'done', progress: '按新要求完成。', evidence: '输入 3、5、8，输出“合计 16”。原始数据读回一致。' }))
  assert.equal(done.note.concept.status, 'done'); assert.equal(done.note.concept.lease, undefined)
  const dependency = await app.call('own_agent_next', { boardId, agentId: 'agent-b' })
  assert.equal(dependency.note.title, '验证效果')
  const status = await app.call('own_agent_status', { boardId })
  assert.equal(status.agents.find(a => a.id === 'agent-b').online, true)
  assert.equal(status.tasks.find(n => n.id === dependency.note.id).concept.lease.token, undefined)
  await editWorkspace(app, notebook => { notebook.agentProjects[0].notes.find(n => n.id === first.note.id).concept.status = 'pending' })
  const invalidatedDependency = await app.call('own_agent_report', report(boardId, dependency, { agentId: 'agent-b' }))
  assert.equal(invalidatedDependency.needsReplan, true, 'reopening a dependency invalidates dependent execution')
})

test('Agent pause, deletion, expired ownership, dependency cycles and backup restore preserve user control', async t => {
  const app = await fixture(t), boardId = (await app.notebook()).boards[0].id
  const bad = plan(boardId); bad.tasks[0].dependsOn = ['verify']
  const cycle = await app.client.callTool({ name: 'own_publish_plan', arguments: bad })
  assert.equal(cycle.isError, true); assert.equal((await app.notebook()).boards[0].notes.some(n => n.kind === 'concept'), false)
  await app.call('own_publish_plan', plan(boardId))
  const first = await app.call('own_agent_next', { boardId, agentId: 'agent-a' })
  await editWorkspace(app, notebook => { notebook.agentProjects[0].notes.find(n => n.id === first.note.id).concept.status = 'paused' })
  assert.equal((await app.call('own_agent_report', report(boardId, first))).needsReplan, true)
  assert.equal((await app.call('own_agent_next', { boardId, agentId: 'agent-a' })).status, 'waiting')
  await editWorkspace(app, notebook => { notebook.agentProjects[0].notes.find(n => n.id === first.note.id).concept.status = 'pending' })
  const active = await app.call('own_agent_next', { boardId, agentId: 'agent-a' })
  const snapshot = (await app.notebook()).agentProjects[0], restored = restoreAgentActivity(snapshot)
  assert.equal(restored.agents.length, 0); assert.equal(restored.notes.find(n => n.id === first.note.id).concept.status, 'pending')
  assert.equal(restored.notes.find(n => n.id === first.note.id).concept.lease, undefined)
  assert.deepEqual(restored.notes.find(n => n.title === '验证效果').concept.dependsOn, [first.note.id])
  await editWorkspace(app, notebook => { const b = notebook.agentProjects[0]; b.notes.find(n => n.id === first.note.id).concept.lease.expiresAt = Date.now() - 1000; b.agents.find(a => a.id === 'agent-a').lastSeenAt = Date.now() - 80000 })
  assert.equal((await app.call('own_agent_status', { boardId })).agents.find(a => a.id === 'agent-a').online, false)
  const reassigned = await app.call('own_agent_next', { boardId, agentId: 'agent-b' })
  assert.equal(reassigned.note.id, first.note.id)
  assert.equal((await app.call('own_agent_report', report(boardId, active))).needsReplan, true)
  const read = await app.call('own_read_board', { boardId:snapshot.id })
  const card = read.notes.find(n => n.id === first.note.id)
  const overwrite = await app.client.callTool({ name: 'own_update_note', arguments: { boardId:snapshot.id, noteId: card.id, expectedHash: card.contentHash, body: 'Agent 不应覆盖用户要求。' } })
  assert.equal(overwrite.isError, true)
  await editWorkspace(app, notebook => { const b = notebook.agentProjects[0]; b.notes = b.notes.filter(n => n.id !== first.note.id); b.connections = b.connections.filter(e => e.from !== first.note.id && e.to !== first.note.id) })
  const deleted = await app.call('own_agent_report', report(boardId, reassigned, { agentId: 'agent-b' }))
  assert.equal(deleted.needsReplan, true); assert.equal(deleted.accepted, false)
  assert.equal((await app.call('own_agent_next', { boardId, agentId: 'agent-b' })).status, 'waiting')
  assert.match(conceptDependencyError([{ id: 'a', kind: 'concept', concept: { dependsOn: ['b'] } }, { id: 'b', kind: 'concept', concept: { dependsOn: ['a'] } }]), /循环/)
})

test('MCP saves multi-language code examples completely without executing them', async t => {
  const app = await fixture(t), boardId = (await app.notebook()).boards[0].id
  const args = { boardId, requestId: 'code-examples', title: '输入输出学习', cells: [{ language: 'javascript', code: 'throw new Error("must not execute on import");', stdin: '中文\n3 5 8', expected: '16\n' }, { language: 'python', code: 'print(input())', stdin: 'Own', expected: 'Own\n' }] }
  const added = await app.call('own_add_code', args)
  assert.equal((await app.call('own_add_code', args)).duplicate, true)
  const note = (await app.notebook()).boards[0].notes.find(n => n.id === added.noteIds[0])
  assert.equal(note.kind, 'code'); assert.equal(note.cells.length, 2); assert.equal(note.cells[0].stdin, args.cells[0].stdin)
  assert.equal(note.cells[0].output, undefined); assert.equal(note.cells[0].executedAt, undefined)
  const data={boardId,requestId:'analysis-data',title:'原始实验数据',format:'csv',data:'类别,值\n甲,3\n乙,5'}
  const analysis=await app.call('own_add_analysis',data)
  assert.equal((await app.call('own_add_analysis',data)).duplicate,true)
  assert.equal((await app.notebook()).boards[0].notes.find(n=>n.id===analysis.noteIds[0]).analysisSource,data.data)
  const invalid=await app.client.callTool({name:'own_add_analysis',arguments:{...data,requestId:'invalid-data',data:'a,b\n"unclosed'}})
  assert.equal(invalid.isError,true)
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
  assert.equal((await client.listTools()).tools.length, 18, errors)
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
