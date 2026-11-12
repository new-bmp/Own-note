import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  ListToolsResultSchema,
  CallToolRequestSchema,
  CallToolResultSchema,
  ListResourcesRequestSchema,
  ListResourcesResultSchema,
  ListResourceTemplatesRequestSchema,
  ListResourceTemplatesResultSchema,
  ReadResourceRequestSchema,
  ReadResourceResultSchema,
  ListPromptsRequestSchema,
  ListPromptsResultSchema,
  GetPromptRequestSchema,
  GetPromptResultSchema,
} from '@modelcontextprotocol/sdk/types.js'

// The running Own HTTP server is the sole writer, including for stdio clients.
const endpoint = new URL('/mcp', process.env.OWN_URL || 'http://127.0.0.1:5173')
if (
  endpoint.protocol !== 'http:' ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)
)
  throw new Error('OWN_URL 必须指向本机运行中的 Own 服务。')
const upstream = new Client({ name: 'own-stdio-bridge', version: '1.0.0' })
try {
  await upstream.connect(new StreamableHTTPClientTransport(endpoint), {
    timeout: 10000,
  })
} catch (error) {
  console.error(
    `无法连接 Own：${endpoint.href}。请先打开 Own 客户端，或在源码目录运行 npm start。\n${error.message}`,
  )
  process.exit(1)
}

const server = new Server(
  { name: 'own-notes', version: '1.0.0', title: 'Own 笔记' },
  {
    capabilities: { tools: {}, resources: {}, prompts: {} },
    instructions: upstream.getInstructions(),
  },
)
for (const [requestSchema, resultSchema] of [
  [ListToolsRequestSchema, ListToolsResultSchema],
  [CallToolRequestSchema, CallToolResultSchema],
  [ListResourcesRequestSchema, ListResourcesResultSchema],
  [ListResourceTemplatesRequestSchema, ListResourceTemplatesResultSchema],
  [ReadResourceRequestSchema, ReadResourceResultSchema],
  [ListPromptsRequestSchema, ListPromptsResultSchema],
  [GetPromptRequestSchema, GetPromptResultSchema],
]) {
  server.setRequestHandler(requestSchema, (request, extra) =>
    upstream.request(request, resultSchema, {
      signal: extra.signal,
      timeout: 60000,
    }),
  )
}
server.onclose = () => {
  void upstream.close()
}
await server.connect(new StdioServerTransport())
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    await server.close()
    process.exit(0)
  })
