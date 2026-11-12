import test from 'node:test'
import { createHash } from 'node:crypto'
import { toolCatalog } from '../mcp/guide.mjs'
import { editAgentBrief } from '../shared/agent-brief.js'
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
  assert.equal(tools.tools.length, toolCatalog.length)
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
    (await app.client.listPrompts()).prompts.some(p=>p.name==='organize_conversation'),
    true,
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

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function waitLab(app,jobId,predicate=v=>!['starting','running'].includes(v.status)){
  const deadline=Date.now()+20000
  while(Date.now()<deadline){const value=await app.call('own_lab_result',{jobId});if(predicate(value))return value;await delay(40)}
  assert.fail('MCP 工作台运行超时：'+JSON.stringify(await app.call('own_lab_result',{jobId})))
}
const execution=lease=>({taskId:lease.note.id,agentId:'agent-a',leaseToken:lease.leaseToken,revision:lease.revision})
async function projectFixture(app){
  const {projectId}=await app.call('own_create_agent_project',{requestId:'long-project',title:'长期数据工作',goal:'产出可复现报告',scope:'仅指定资料',constraints:'保留原始数据',acceptance:'真实运行并附证据'})
  const args=plan(undefined);delete args.boardId;args.projectId=projectId
  const published=await app.call('own_publish_plan',args),lease=await app.call('own_agent_next',{projectId,agentId:'agent-a'})
  return {projectId,published,lease,args}
}

test('all features are discoverable through HTTP, catalog, resources and resume prompt without execution tokens',async t=>{
  const app=await fixture(t),{projectId,lease}=await projectFixture(app)
  const discovered=(await app.client.listTools()).tools,names=discovered.map(t=>t.name).sort()
  for(const name of ['own_run_code','own_start_debug','own_debug_command']){const tool=discovered.find(t=>t.name===name);assert.equal(tool.annotations.destructiveHint,true);assert.equal(tool.annotations.openWorldHint,true)}
  assert.equal(names.length,toolCatalog.length);assert.deepEqual(names,toolCatalog.map(([name])=>name).sort())
  assert.deepEqual((await app.call('own_capabilities',{})).tools.map(t=>t.name).sort(),names)
  const catalog=JSON.parse((await app.client.readResource({uri:'own://capabilities'})).contents[0].text)
  assert.deepEqual(catalog.tools.map(t=>t.name).sort(),names)
  const brief=JSON.parse((await app.client.readResource({uri:`own://agent-projects/${projectId}`})).contents[0].text)
  assert.equal(brief.brief.constraints,'保留原始数据')
  const prompt=await app.client.getPrompt({name:'resume_agent_project',arguments:{projectId,agentId:'agent-a'}})
  assert.match(prompt.messages[0].content.text,/own_agent_checkpoint/)
  for(const tool of ['own_read_agent_project','own_read_board','own_agent_status'])assert.ok(!JSON.stringify(await app.call(tool,{projectId})).includes(lease.leaseToken),tool)
  assert.ok(!JSON.stringify(await app.call('own_read_note',{projectId,noteId:lease.note.id})).includes(lease.leaseToken))
  assert.deepEqual((await(await app.request('/api/integrations')).json()).tools.map(([name])=>name).sort(),names)
})

test('long-running project checkpoints retain full context, support reconnect, preserve user edits and invalidate old work',async t=>{
  const app=await fixture(t),{projectId,lease,published,args}=await projectFixture(app)
  const material=await app.call('own_add_note',{projectId,requestId:'artifact',title:'实际输出',body:'验证资料'})
  const markdown='## 已完成与依据\n\n'+('保留实际过程、输入、测试和限制。\n'.repeat(7000))+'\n## 下一步\n核验最后一行。'
  const checkpoint={projectId,requestId:'checkpoint-1',...execution(lease),title:'会话交接',markdown,nextAction:'核验最后一行',blockers:['等待确认口径'],artifactIds:material.noteIds}
  const saved=await app.call('own_agent_checkpoint',checkpoint)
  assert.equal((await app.call('own_agent_checkpoint',checkpoint)).duplicate,true)
  assert.equal((await app.client.callTool({name:'own_agent_checkpoint',arguments:{...checkpoint,markdown:'不同记录'}})).isError,true)
  assert.equal((await app.client.callTool({name:'own_agent_checkpoint',arguments:{...checkpoint,requestId:'bad-artifact',artifactIds:['missing']}})).isError,true)
  const second=await app.connect(),read=await second.callTool({name:'own_read_agent_project',arguments:{projectId,limit:1}})
  assert.equal(read.structuredContent.brief.goal,'产出可复现报告');assert.equal(read.structuredContent.total,2);assert.equal(read.structuredContent.nextOffset,1)
  assert.equal((await app.call('own_read_note',{projectId,noteId:saved.noteId})).note.body,markdown)
  const resumed=await app.call('own_agent_next',{projectId,agentId:'agent-a'})
  assert.equal(resumed.resume.checkpointId,saved.noteId);assert.deepEqual(resumed.resume.artifactIds,material.noteIds)
  const context=await app.call('own_read_note',{projectId,noteId:published.overviewId})
  assert.equal((await app.client.callTool({name:'own_update_note',arguments:{projectId,noteId:published.overviewId,expectedHash:context.contentHash,body:'覆盖用户方案'}})).isError,true)
  await editWorkspace(app,book=>{book.agentProjects.find(p=>p.id===projectId).notes.find(n=>n.id===published.overviewId).body+='\n用户新增要求：仅生成季度报告。'})
  assert.equal((await app.call('own_agent_report',{...report(undefined,lease),projectId})).needsReplan,true)
  assert.equal((await app.client.callTool({name:'own_agent_checkpoint',arguments:{...checkpoint,requestId:'stale'}})).isError,true)
  assert.equal((await app.call('own_publish_plan',args)).duplicate,true)
  assert.equal((await app.client.callTool({name:'own_publish_plan',arguments:{...args,title:'同ID不同方案'}})).isError,true)
  const fresh=await app.call('own_agent_next',{projectId,agentId:'agent-a'});assert.notEqual(fresh.leaseToken,lease.leaseToken)
  await editWorkspace(app,book=>{const index=book.agentProjects.findIndex(p=>p.id===projectId);book.agentProjects[index]=editAgentBrief(book.agentProjects[index],{constraints:'只做只读分析'})})
  assert.equal((await app.call('own_agent_report',{...report(undefined,fresh),projectId})).needsReplan,true)
  assert.equal((await app.call('own_read_agent_project',{projectId})).brief.constraints,'只做只读分析')
  await editWorkspace(app,book=>{const i=book.agentProjects.findIndex(p=>p.id===projectId);book.agentProjects[i]=editAgentBrief(book.agentProjects[i],{goal:''})})
  assert.equal((await app.call('own_read_agent_project',{projectId})).brief.goal,'')
})

test('MCP streams and saves actual code output once across concurrent retries, and preserves changed source',async t=>{
  const app=await fixture(t),boardId=(await app.notebook()).activeBoardId
  const added=await app.call('own_add_code',{boardId,requestId:'code-stream',title:'求和',cells:[{language:'javascript',stdin:'3 5',expected:'8',code:"let input='';for await(const chunk of process.stdin)input+=chunk;console.log('开始');await new Promise(r=>setTimeout(r,700));console.log(input.trim().split(/\\s+/).map(Number).reduce((a,b)=>a+b,0));"}]})
  let read=await app.call('own_read_note',{boardId,noteId:added.noteIds[0]})
  const args={boardId,requestId:'run-once',noteId:read.note.id,cellId:read.note.cells[0].id,expectedHash:read.contentHash}
  const results=await Promise.all(Array.from({length:4},()=>app.call('own_run_code',args)))
  assert.equal(new Set(results.map(r=>r.id)).size,1)
  const streamed=await waitLab(app,results[0].id,v=>v.status==='running'&&v.stdout.includes('开始'));assert.equal(streamed.savedToNote,false)
  const done=await waitLab(app,results[0].id,v=>v.status==='success'&&v.savedToNote);assert.equal(done.stdout,'开始\n8\n')
  read=await app.call('own_read_note',{boardId,noteId:read.note.id});assert.equal(read.note.cells[0].executionCount,1);assert.equal(read.note.cells[0].executedInput,'3 5')
  assert.equal((await app.call('own_run_code',args)).id,done.id)
  assert.equal((await app.client.callTool({name:'own_run_code',arguments:{...args,requestId:'old-source'}})).isError,true)
  const slow=await app.call('own_run_code',{...args,requestId:'source-edited',expectedHash:read.contentHash})
  const cells=read.note.cells.map(c=>({id:c.id,language:c.language,stdin:c.stdin,code:'console.log("user edit");'}))
  await app.call('own_update_note',{boardId,noteId:read.note.id,expectedHash:read.contentHash,cells})
  const discarded=await waitLab(app,slow.id,v=>!['running','starting'].includes(v.status)&&!!v.resultNotice)
  assert.equal(discarded.savedToNote,false);assert.match(discarded.resultNotice,/修改/)
  assert.equal((await app.call('own_read_note',{boardId,noteId:read.note.id})).note.cells[0].code,cells[0].code)
})

test('project pause and execution switches stop bound jobs and reject writes, debugging and old credentials',async t=>{
  const app=await fixture(t),{projectId,lease}=await projectFixture(app)
  const added=await app.call('own_add_code',{projectId,requestId:'bound-code',title:'长期任务',cells:[{language:'javascript',code:'console.log("active");setInterval(()=>{},1000);'}]})
  const note=await app.call('own_read_note',{projectId,noteId:added.noteIds[0]})
  const args={projectId,requestId:'bound-run',noteId:note.note.id,cellId:note.note.cells[0].id,expectedHash:note.contentHash}
  assert.equal((await app.client.callTool({name:'own_run_code',arguments:args})).isError,true)
  const run=await app.call('own_run_code',{...args,execution:execution(lease)})
  await waitLab(app,run.id,v=>v.stdout.includes('active'))
  await editWorkspace(app,book=>{const i=book.agentProjects.findIndex(p=>p.id===projectId);book.agentProjects[i]=editAgentBrief(book.agentProjects[i],{paused:true})})
  assert.equal((await waitLab(app,run.id)).status,'stopped')
  assert.equal((await app.call('own_agent_next',{projectId,agentId:'agent-a'})).status,'paused')
  for(const [name,arguments_]of [['own_add_note',{projectId,requestId:'paused-note',title:'不能写',body:'正文'}],['own_save_conversation',{projectId,requestId:'paused-conversation',title:'不能写',summary:'暂停时不写',markdown:'正文'}]])assert.equal((await app.client.callTool({name,arguments:arguments_})).isError,true)
  await editWorkspace(app,book=>{const i=book.agentProjects.findIndex(p=>p.id===projectId);book.agentProjects[i]=editAgentBrief(book.agentProjects[i],{paused:false,allowCode:false})})
  let fresh=await app.call('own_agent_next',{projectId,agentId:'agent-a'})
  assert.equal((await app.client.callTool({name:'own_start_debug',arguments:{...args,requestId:'disabled-debug',execution:execution(fresh)}})).isError,true)
  await editWorkspace(app,book=>{const i=book.agentProjects.findIndex(p=>p.id===projectId);book.agentProjects[i]=editAgentBrief(book.agentProjects[i],{allowCode:true})})
  fresh=await app.call('own_agent_next',{projectId,agentId:'agent-a'})
  const debug=await app.call('own_start_debug',{...args,requestId:'bound-debug',execution:execution(fresh)})
  await waitLab(app,debug.id,v=>v.status==='paused')
  await editWorkspace(app,book=>{const i=book.agentProjects.findIndex(p=>p.id===projectId);book.agentProjects[i]=editAgentBrief(book.agentProjects[i],{scope:'新的用户工作范围'})})
  assert.equal((await waitLab(app,debug.id)).status,'stopped')
  assert.equal((await app.client.callTool({name:'own_debug_command',arguments:{jobId:debug.id,action:'continue'}})).isError,true)
})

test('MCP debugger exposes real variables, watches, breakpoints, stepping and saved output',async t=>{
  const app=await fixture(t),boardId=(await app.notebook()).activeBoardId
  const saved=await app.call('own_add_code',{boardId,requestId:'debug-code',title:'单步学习',cells:[{language:'javascript',code:'let total = 3;\ntotal += 5;\nconsole.log(total);\ntotal += 2;\nconsole.log(total);'}]})
  const note=await app.call('own_read_note',{boardId,noteId:saved.noteIds[0]})
  const job=await app.call('own_start_debug',{boardId,requestId:'debug-run',noteId:note.note.id,cellId:note.note.cells[0].id,expectedHash:note.contentHash,breakpoints:[2],watches:['total * 2']})
  let value=await waitLab(app,job.id,v=>v.status==='paused')
  if(value.line!==2){await app.call('own_debug_command',{jobId:job.id,action:'continue'});value=await waitLab(app,job.id,v=>v.status==='paused'&&v.line===2)}
  assert.equal(value.variables.find(v=>v.name==='total').value,'3');assert.equal(value.watches[0].value,'6')
  await app.call('own_debug_command',{jobId:job.id,action:'next'});value=await waitLab(app,job.id,v=>v.status==='paused'&&v.line===3)
  assert.equal(value.variables.find(v=>v.name==='total').value,'8');assert.equal(value.watches[0].value,'16');assert.ok(value.frames.length)
  await app.call('own_debug_command',{jobId:job.id,action:'continue'});value=await waitLab(app,job.id,v=>v.status==='finished'&&v.savedToNote)
  assert.equal(value.stdout,'8\n10\n');assert.equal((await app.call('own_read_note',{boardId,noteId:note.note.id})).note.cells[0].output,'8\n10\n')
})

test('analysis MCP retains row origins, sorts negative decimals, aggregates filtered data and saves reproducible charts',async t=>{
  const app=await fixture(t),{projectId}=await projectFixture(app)
  const saved=await app.call('own_add_analysis',{projectId,requestId:'data',title:'真实数据',data:'类别,数值\n甲,-2.5\n乙,10\n甲,1.5\n乙,\n丙,2',settings:{group:0,value:1,method:'sum'}})
  const noteId=saved.noteIds[0],analyzed=await app.call('own_analyze_data',{projectId,noteId,settings:{sort:{column:1,ascending:true},filter:{column:1,operator:'less',value:'3'}},limit:2})
  assert.deepEqual(analyzed.rows.map(r=>r.index),[1,3]);assert.equal(analyzed.nextOffset,2);assert.equal(analyzed.filteredRows,3);assert.equal(analyzed.statistics[1].sum,1)
  assert.deepEqual(analyzed.groups,[{label:'甲',value:-1},{label:'丙',value:2}])
  const settings={group:0,value:1,method:'sum',order:'label',chartType:'bar'}
  const chart=await app.call('own_chart_from_analysis',{projectId,requestId:'real-chart',title:'来源可复查',noteId,expectedHash:analyzed.contentHash,settings})
  const read=await app.call('own_read_note',{projectId,noteId:chart.noteIds[0]})
  assert.deepEqual(Object.fromEntries(read.note.chart.labels.map((label,i)=>[label,read.note.chart.series[0].values[i]])),{甲:-1,乙:10,丙:2});assert.equal(read.note.analysisOrigin.contentHash,analyzed.contentHash);assert.equal(chart.truncated,false)
  await app.call('own_update_note',{projectId,noteId,expectedHash:analyzed.contentHash,analysisSource:'类别,数值\n甲,99'})
  assert.equal((await app.client.callTool({name:'own_chart_from_analysis',arguments:{projectId,requestId:'stale-chart',title:'旧数据',noteId,expectedHash:analyzed.contentHash,settings}})).isError,true)
  const grid=await app.call('own_add_chart',{projectId,requestId:'grid-chart',title:'表格制图',grid:[['月份','销量'],['一月',3],['二月',5]]})
  assert.deepEqual((await app.call('own_read_note',{projectId,noteId:grid.noteIds[0]})).note.chart.labels,['一月','二月'])
  const conversation=await app.call('own_save_conversation',{projectId,requestId:'project-conversation',title:'分析说明',summary:'完整结论',markdown:'## 方法\n使用原始数据。\n## 结论\n保留负数与空值。'})
  assert.equal((await app.call('own_read_conversation',{projectId,requestId:'project-conversation',includeOriginal:true})).verification.status,'verified');assert.ok(conversation.readerUrl.includes('mode=agents'))
})

async function upload(app,bytes,filename,requestId){
  const sha256=createHash('sha256').update(bytes).digest('hex'),args={action:'start',requestId,filename,size:bytes.length,sha256}
  const starts=await Promise.all([app.call('own_upload_asset',args),app.call('own_upload_asset',args)]);assert.equal(starts[0].uploadId,starts[1].uploadId)
  const uploadId=starts[0].uploadId
  for(let offset=0;offset<bytes.length;offset+=262144){const args={action:'chunk',uploadId,offset,data:bytes.subarray(offset,offset+262144).toString('base64')};await app.call('own_upload_asset',args);await app.call('own_upload_asset',args)}
  const result=await app.call('own_upload_asset',{action:'commit',uploadId});assert.equal((await app.call('own_upload_asset',{action:'commit',uploadId})).assetId,result.assetId);assert.equal(result.contentHash,sha256);return result
}

test('MCP uploads arbitrary files losslessly, preserves folders, empty files and model resources, and guards connections',async t=>{
  const app=await fixture(t),boardId=(await app.notebook()).activeBoardId,bytes=Buffer.alloc(360000);for(let i=0;i<bytes.length;i++)bytes[i]=i%251
  const asset=await upload(app,bytes,'原始.bin','binary'),empty=await upload(app,Buffer.alloc(0),'空.txt','empty'),model=await upload(app,Buffer.from('solid sample\nendsolid sample'),'sample.stl','model')
  const folder=await app.call('own_add_attachment',{boardId,requestId:'folder',title:'完整目录',kind:'folder',entries:[{path:'资料/原始.bin',kind:'file',assetId:asset.assetId},{path:'资料/空.txt',kind:'file',assetId:empty.assetId},{path:'空目录',kind:'directory'},{path:'模型/sample.stl',kind:'file',assetId:model.assetId}],modelPath:'模型/sample.stl',modelSettings:{wireframe:true,grid:false,autoRotate:false}})
  const noteId=folder.noteIds[0],directory=await app.call('own_read_attachment',{boardId,noteId,limit:2});assert.equal(directory.total,6);assert.equal(directory.nextOffset,2)
  assert.ok((await app.call('own_read_note',{boardId,noteId})).note.entries.some(e=>e.path==='空目录'&&e.kind==='directory'))
  const chunks=[];let offset=0
  do{const read=await app.call('own_read_attachment',{boardId,noteId,path:'资料/原始.bin',offset,limit:70001});assert.equal(read.contentHash,asset.contentHash);assert.ok(!('file'in read));chunks.push(Buffer.from(read.data,'base64'));offset=read.nextOffset}while(offset!==null)
  assert.deepEqual(Buffer.concat(chunks),bytes)
  assert.equal((await app.call('own_read_attachment',{boardId,noteId,path:'资料/空.txt'})).bytes,0)
  assert.equal((await app.client.callTool({name:'own_add_attachment',arguments:{boardId,requestId:'unsafe-folder',title:'非法目录',kind:'folder',entries:[{path:'../outside',kind:'file',assetId:asset.assetId}]}})).isError,true)
  const pending=await app.call('own_upload_asset',{action:'start',requestId:'bad-sha',filename:'bad.bin',size:3,sha256:'0'.repeat(64)})
  assert.equal((await app.client.callTool({name:'own_upload_asset',arguments:{action:'chunk',uploadId:pending.uploadId,offset:1,data:Buffer.from('x').toString('base64')}})).isError,true)
  await app.call('own_upload_asset',{action:'chunk',uploadId:pending.uploadId,offset:0,data:Buffer.from('abc').toString('base64')})
  assert.equal((await app.client.callTool({name:'own_upload_asset',arguments:{action:'chunk',uploadId:pending.uploadId,offset:0,data:Buffer.from('xyz').toString('base64')}})).isError,true)
  assert.equal((await app.client.callTool({name:'own_upload_asset',arguments:{action:'commit',uploadId:pending.uploadId}})).isError,true)
  for(let i=0;i<17;i++)await upload(app,Buffer.alloc(0),`空${i}.txt`,`empty-${i}`)
  const file=await app.call('own_add_attachment',{boardId,requestId:'file',title:'单文件',assetId:asset.assetId})
  const args={boardId,requestId:'edge',from:noteId,to:file.noteIds[0],label:'参考资料',style:'elbow',arrow:'both',dashed:true,color:'#aabbcc',fromSide:'right',toSide:'left'}
  const edge=await app.call('own_connect_notes',args);assert.equal((await app.call('own_connect_notes',args)).duplicate,true)
  const edited=await app.call('own_update_connection',{boardId,connectionId:edge.connection.id,expectedHash:edge.contentHash,label:'新的关系',style:'curve'})
  assert.equal(edited.connection.label,'新的关系')
  assert.equal((await app.client.callTool({name:'own_update_connection',arguments:{boardId,connectionId:edge.connection.id,expectedHash:edge.contentHash,label:'旧版本'}})).isError,true)
})

test('MCP media conversion saves permanent results and persists player settings without changing originals',async t=>{
  const app=await fixture(t),boardId=(await app.notebook()).activeBoardId,wav=Buffer.alloc(44+8820)
  wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(44100,24);wav.writeUInt32LE(88200,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(8820,40)
  const asset=await upload(app,wav,'sample.wav','wav')
  const mediaSettings={speed:1.5,volume:.4,loop:true,start:.02,marks:[{time:.03,label:'说明'}]}
  const note=await app.call('own_add_attachment',{boardId,requestId:'media-note',title:'原始录音',assetId:asset.assetId,mediaSettings})
  const job=await app.call('own_convert_media',{boardId,requestId:'convert',noteId:note.noteIds[0],type:'audio'})
  const done=await waitLab(app,job.id);assert.equal(done.status,'success',done.stderr);assert.equal(done.savedToNote,false,'conversion cache is not a permanent note')
  const saved=await app.call('own_save_media_result',{boardId,requestId:'save-converted',title:'兼容录音',jobId:job.id})
  const original=await app.call('own_read_note',{boardId,noteId:note.noteIds[0]}),converted=await app.call('own_read_attachment',{boardId,noteId:saved.noteIds[0]})
  assert.deepEqual(original.note.mediaSettings,mediaSettings);assert.equal(original.note.assetId,asset.assetId);assert.equal(converted.mime,'audio/mpeg');assert.ok(converted.size>0)
  assert.equal((await app.call('own_save_media_result',{boardId,requestId:'save-converted',title:'兼容录音',jobId:job.id})).duplicate,true)
  await app.call('own_update_note',{boardId,noteId:original.note.id,expectedHash:original.contentHash,mediaSettings:{...mediaSettings,speed:2},x:20,y:30})
  assert.equal((await app.call('own_read_note',{boardId,noteId:original.note.id})).note.mediaSettings.speed,2)
})

test('accepted execution requests cannot silently rerun after the Own service restarts',async t=>{
  const app=await fixture(t),boardId=(await app.notebook()).activeBoardId
  const saved=await app.call('own_add_code',{boardId,requestId:'restart-code',title:'重启幂等保护',cells:[{language:'javascript',code:'console.log("once");'}]})
  const note=await app.call('own_read_note',{boardId,noteId:saved.noteIds[0]}),args={boardId,requestId:'durable-request',noteId:note.note.id,cellId:note.note.cells[0].id,expectedHash:note.contentHash}
  const job=await app.call('own_run_code',args);await waitLab(app,job.id,v=>v.savedToNote)
  const server=await createFieldnotesServer({dataDir:app.directory});server.listen(0,'127.0.0.1');await once(server,'listening')
  const client=new Client({name:'restarted-service',version:'1.0.0'})
  try{
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.address().port}/mcp`)))
    const retry=await client.callTool({name:'own_run_code',arguments:args});assert.equal(retry.isError,true);assert.match(retry.content[0].text,/已受理/)
    const read=await client.callTool({name:'own_read_note',arguments:{boardId,noteId:note.note.id}});assert.equal(read.structuredContent.note.cells[0].executionCount,1)
  }finally{await client.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
})

test('independent Agent projects can be discovered, created idempotently and used without a canvas ID',async t=>{
  const app=await fixture(t),before=(await app.notebook()).boards
  const created=await app.call('own_create_agent_project',{requestId:'independent',title:'独立代码学习',description:'公开实现过程'})
  assert.equal((await app.call('own_create_agent_project',{requestId:'independent',title:'独立代码学习',description:'公开实现过程'})).duplicate,true)
  assert.equal((await app.client.callTool({name:'own_create_agent_project',arguments:{requestId:'independent',title:'不同项目'}})).isError,true)
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
  assert.equal((await client.listTools()).tools.length, toolCatalog.length, errors)
  assert.equal(client.getServerVersion().version,'1.5.0')
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


test('MCP creates nested canvases atomically with shared storage, discovers paths and protects retries and invalid references', async t => {
  const app = await fixture(t, true)
  const root = await app.call('own_create_board', { requestId: 'root-001', title: '汇报' })
  const args = { requestId: 'child-001', parentBoardId: root.boardId, title: '详情', x: -300, y: 150 }
  const child = await app.call('own_create_board', args)
  const nested = await app.call('own_create_board', { requestId: 'nested-001', parentBoardId: child.boardId, title: '原始依据' })
  assert.equal(child.parentBoardId, root.boardId)
  assert.equal(child.sharedStorage, true)
  assert.ok(child.portalNoteId)
  const rootRead = await app.call('own_read_board', { boardId: root.boardId })
  assert.equal(rootRead.notes[0].kind, 'board')
  assert.equal(rootRead.notes[0].childBoardId, child.boardId)
  assert.equal(rootRead.notes[0].x, -300)
  assert.equal(rootRead.notes[0].y, 150)
  assert.deepEqual(rootRead.childBoards.map(board => board.id), [child.boardId])
  const detail = await app.call('own_read_board', { boardId: nested.boardId })
  assert.deepEqual(detail.path.map(board => board.id), [root.boardId, child.boardId, nested.boardId])
  const listed = await app.call('own_list_boards', { parentBoardId: root.boardId })
  assert.deepEqual(listed.boards.map(board => board.id), [child.boardId])
  assert.equal((await app.call('own_capabilities', { feature: 'canvas' })).help.example.tool, 'own_create_board')
  const second = await app.connect()
  const retry = (await second.callTool({ name: 'own_create_board', arguments: args })).structuredContent
  assert.equal(retry.boardId, child.boardId)
  assert.equal(retry.duplicate, true)
  assert.equal((await app.notebook()).boards.length, 3)
  for (const invalid of [{ ...args, title: '不同内容' }, { requestId: 'bad-parent', title: '不能创建', parentBoardId: 'missing' }]) {
    const before = await app.notebook()
    assert.equal((await app.client.callTool({ name: 'own_create_board', arguments: invalid })).isError, true)
    assert.deepEqual(await app.notebook(), before)
  }
  const bytes = new Uint8Array([0, 1, 2, 255])
  assert.equal((await app.request('/api/assets/shared-nested', { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes })).status, 200)
  for (const boardId of [root.boardId, nested.boardId]) await app.call('own_add_attachment', { boardId, requestId: 'file-' + boardId, kind: 'file', title: '共享附件', filename: 'data.bin', assetId: 'shared-nested' })
  const stored = await app.notebook()
  assert.deepEqual(stored.boards.flatMap(board => board.notes.filter(note => note.assetId).map(note => note.assetId)), ['shared-nested', 'shared-nested'])
  const response = await app.request('/api/notebook')
  stored.boards[0].parentBoardId = nested.boardId
  assert.equal((await app.request('/api/notebook', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': response.headers.get('etag') }, body: JSON.stringify(stored) })).status, 400)
  assert.notEqual((await app.notebook()).boards[0].parentBoardId, nested.boardId)
})
