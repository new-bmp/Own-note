import { useEffect, useState } from 'react'
import { Bot, Check, Copy, ExternalLink, Plug } from 'lucide-react'
import { downloadFile } from './storage'

interface Integration {
  url: string
  name: string
  stdio: { command: string; args: string[]; env: Record<string, string> }
  tools: [string, string][]
}
const organizePrompt = '把当前会话完整整理到 Own：摘要作为导读，正文保留需求与约束、方案和理由、具体步骤、代码与表格、实际结果和未完成事项；列出行动项与待确认问题。保存后读回核对正文结尾、章节和任务数量，给我完整会话的阅读链接。'

export function AgentConnection() {
  const [integration, setIntegration] = useState<Integration>()
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'http' | 'stdio' | 'codex'>('http')
  const [copied, setCopied] = useState(false)
  const [promptCopied, setPromptCopied] = useState(false)
  const [planCopied, setPlanCopied] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/integrations', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error('暂时无法取得连接信息，请确认 Own 服务正在运行。')
        setIntegration((await response.json()) as Integration)
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message)
      })
    return () => controller.abort()
  }, [])
  const config = integration
    ? tab === 'codex'
      ? `[mcp_servers.own]\nurl = ${JSON.stringify(integration.url)}`
      : JSON.stringify(
          {
            mcpServers: {
              own:
                tab === 'http' ? { url: integration.url } : integration.stdio,
            },
          },
          null,
          2,
        )
    : ''
  async function copy() {
    try {
      await navigator.clipboard.writeText(config)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('复制未成功，请选中配置手动复制，或下载配置文件。')
    }
  }
  return (
    <div className="agent-connection">
      <span className="agent-illustration">
        <Bot size={26} />
      </span>
      <span className="section-overline">OWN × AGENT</span>
      <h2>把会话，变成可用的笔记。</h2>
      <p>
        让 agent
        完整记录背景、过程与结果，再用公式与图把复杂问题讲清楚。保存后可展开会话，连续阅读正文和行动项。
      </p>
      <div className="agent-endpoint">
        <Plug size={16} />
        <div>
          <small>本机 MCP · Streamable HTTP</small>
          <code>{integration?.url || '正在获取连接地址…'}</code>
        </div>
        <span className="agent-online">
          {integration ? '服务就绪' : '连接中'}
        </span>
      </div>
      <ol className="agent-steps">
        <li>在 agent 客户端的 MCP 设置中添加下面的配置。</li>
        <li>保持 Own 服务运行，重新连接或重启客户端。</li>
        <li>
          复制下面的整理要求，发给 agent，保存后核对内容。
        </li>
      </ol>
      <div className="agent-task-prompt">
        <p>长期工作：在独立的“Agent Next to do”模式中明确目标和边界，查看方案、下一步、阻塞、产物与交接记录。修改约束或暂停项目后，Agent 必须停止旧执行并重新读取。</p>
        <button onClick={async()=>{try{await navigator.clipboard.writeText('请通过 Own 管理长期工作：先 own_capabilities(feature:agent)，查找独立 Agent 项目并用 own_read_agent_project 读取最新目标、范围、约束、验收、方案与工作记录。用 own_publish_plan 发布可供我理解的完整公开方案和任务，不覆盖我的修改。own_agent_next 领取任务；执行前、关键步骤后及每30秒 own_agent_report；needsReplan=true 或项目暂停时停止旧执行并重读。持续用 own_agent_checkpoint 保存已完成、依据、未完成、下一步、阻塞与产物引用，便于换会话恢复。新功能先查 own_capabilities：代码/调试必须显式运行，项目中携带 execution 凭证；分析图表保留数据来源；文件上传后读回校验；媒体转换后保存永久结果。提交 done 提供实际产物、测试与限制。只公开方案和事实，不提交隐藏推理，严格遵守原本授权范围。');setPlanCopied(true)}catch{setError('复制未成功，请选中内容手动复制。')}}}>{planCopied?<Check size={13}/>:<Copy size={13}/>}复制 Next to do 协作要求</button>
        <p>{organizePrompt}</p>
        <button onClick={async () => {
          try {
            await navigator.clipboard.writeText(organizePrompt)
            setPromptCopied(true)
            setTimeout(() => setPromptCopied(false), 2000)
          } catch { setError('复制未成功，请选中整理要求手动复制。') }
        }}>{promptCopied ? <Check size={13} /> : <Copy size={13} />}{promptCopied ? '已复制' : '复制整理要求'}</button>
      </div>
      <div
        className="agent-config-tabs"
        role="tablist"
        aria-label="MCP 配置方式"
      >
        {(
          [
            ['http', 'HTTP'],
            ['stdio', 'stdio'],
            ['codex', 'Codex'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'active' : ''}
            onClick={() => {
              setTab(id)
              setCopied(false)
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="agent-config">
        <pre>{config || '正在加载配置…'}</pre>
        <button disabled={!integration} onClick={() => void copy()}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? '已复制' : '复制配置'}
        </button>
      </div>
      {tab === 'codex' && (
        <p className="agent-small">
          将此段加入 Codex 的 MCP 配置文件，或运行{' '}
          <code>codex mcp add own --url {integration?.url}</code>。
        </p>
      )}
      {tab === 'stdio' && (
        <p className="agent-small">
          stdio 桥接到同一个本机服务，所有客户端共享画布。Own 需先运行。
        </p>
      )}
      <p className="agent-small">
        会话由当前 agent 整理后传入；Own
        不会自动读取其他聊天。写入可重试，已有卡片更新会检查版本。
      </p>
      {error && (
        <div className="rich-error" role="alert">
          {error}
        </div>
      )}
      <details className="agent-tools">
        <summary>查看可用工具 · {integration?.tools.length || 0} 个</summary>
        <div>
          {integration?.tools.map(([name, title]) => (
            <p key={name}>
              <code>{name}</code>
              <span>{title}</span>
            </p>
          ))}
        </div>
      </details>
      <div className="agent-footer">
        <button
          className="secondary-button"
          disabled={!integration}
          onClick={() =>
            downloadFile(
              new Blob([config], {
                type: tab === 'codex' ? 'text/plain' : 'application/json',
              }),
              tab === 'codex' ? 'own-mcp.toml' : 'own-mcp.json',
            )
          }
        >
          下载配置
        </button>
        <a
          href="https://modelcontextprotocol.io/"
          target="_blank"
          rel="noreferrer"
        >
          MCP 文档 <ExternalLink size={12} />
        </a>
      </div>
    </div>
  )
}
