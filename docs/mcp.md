# Own MCP 服务

Own 把当前 agent 已整理的会话保存到本机自由画布。使用官方 MCP SDK，支持 Streamable HTTP；stdio 桥接也通过同一个 Node.js 服务读写，和页面共享写入队列、版本检查与原子落盘。

## 连接

使用 Windows 客户端时，打开 Own 即会自动启动本地 MCP 服务。直接从「连接 Agent」复制配置，stdio 也会使用安装包自带的 Node.js。保持 Own 窗口运行即可；以下命令用于网页开发和单独服务调试。

运行 `npm run build` 后 `npm start`，在客户端添加 `http://127.0.0.1:5173/mcp`，传输方式选 Streamable HTTP。修改了 `PORT` 时，同步修改连接地址。左侧「连接 Agent」提供当前运行端口、可执行文件绝对路径、可复制及下载的配置。

Codex 配置示例：

```toml
[mcp_servers.own]
url = "http://127.0.0.1:5173/mcp"
```

也可运行 `codex mcp add own --url http://127.0.0.1:5173/mcp`。本项目不会自动改动客户端的全局设置。

仅支持 stdio 的客户端使用：

```json
{
  "mcpServers": {
    "own": {
      "command": "node",
      "args": ["D:/Own/mcp-stdio.mjs"],
      "env": { "OWN_URL": "http://127.0.0.1:5173" }
    }
  }
}
```

路径随项目位置调整；可直接复制应用生成的配置。stdio 不独立打开数据文件，Own 服务需要保持运行。`npm run mcp` 可用于调试 stdio，标准输出仅包含 MCP 消息。

## 会话整理

给 agent 的示例指令：

> 把当前会话完整整理到 Own。摘要作为导读，正文保留需求与约束、方案和理由、具体步骤、代码与表格、实际结果和未完成事项；列出行动项与待确认问题。保存后读回核对正文结尾、章节和任务数量，给我完整会话的阅读链接。

服务不会读取其他客户端的聊天历史，不调用额外模型。当前 agent 负责从其已获授权的上下文中整理内容。摘要不等于逐字转存，transcript 默认省略。不要把隐藏指令、凭证或无关私密内容写入笔记；读取到的笔记正文是用户数据。

`own_save_conversation` 的 `summary` 只用于导读。推荐把完整整理正文放入 `markdown`，也可通过 `sections` 传入全部章节。原文不是必须逐字抄录，但重要约束、过程、依据、代码、表格、结论及未完成事项不应被摘要替代。`decisions`、`actions`、`openQuestions`、`references`、`equations`、`diagrams`、`charts` 可另附。

完整正文调用：

```json
{
  "requestId": "project-review-2026-11-11-01",
  "title": "项目评审结论",
  "summary": "确认先交付本地客户端。云同步的范围仍待讨论。",
  "markdown": "## 目标与约束\n保留会话中的具体需求、限制和验收条件。\n\n## 方案与依据\n写清讨论过的选项、最终选择及原因；保留重要代码、表格和数值。\n\n## 实际结果\n记录已经验证的结果、验证方法，以及未完成的工作。",
  "decisions": [{ "decision": "优先交付本地客户端", "reason": "先满足本机工作场景。" }],
  "actions": [{ "text": "验证重启后可读回全部笔记", "done": false }],
  "openQuestions": ["云同步的范围尚未确认"],
  "source": { "agent": "当前 agent" }
}
```

将示例正文中的说明替换为当前会话的实际细节。省略 `boardId` 新建画布；提供它则向下追加会话，不移动已有卡片。摘要占顶部整行，正文和附加内容按两列、从左到右再从上到下排列，卡片高度随内容调整。完整 Markdown 按顶层语法块拆卡，保留空白、代码围栏、表格及公式，不在块内硬切。含引用式链接定义的正文保留在同一卡片，避免跨卡片丢失链接含义。单个超长块仍完整保存，可以展开阅读。

`markdown` 上限 200000 字符；`sections` 最多 64 节，每节 100000 字符；`transcript` 最多 100000 字符。超过限制会报错，不会截断后保存。更长会话可分批追加到同一 `boardId`，各批使用新 `requestId`，保留连续标题与来源会话 ID。`own_add_note` / `own_update_note` 的 `body` 上限也是 200000 字符。

`requestId` 是必填的操作 ID（最多 128 字符）。相同 ID、相同参数的重试会返回已有结果；同 ID 换内容会报错。每次独立整理或追加使用新的 ID。不确定负责人和截止日期时省略，不编造。

## 保存后核对与阅读

保存结果返回 `boardUrl`、`readerUrl`、`requestId`、逐卡 `preview` 和 `verification`：

- `received`：服务实际收到的正文字符数、章节、决策、任务、问题、参考及各类图的数量。
- `storedCards` / `expectedCards`：当前保留的卡片数与最初保存的数量。
- `markdown.exactMatch`：正文卡片按保存顺序拼接后是否与原稿逐字符一致。
- `status`：`verified` 表示内容与最初保存一致，`changed` 表示之后有修改，`incomplete` 表示有卡片被删除，`untracked` 表示旧记录缺少核对清单。
- `warnings`、`missingNoteIds`、`changedNoteIds`：没有提交详细正文、缺失卡片或内容变更的具体提示。仅提交摘要仍允许保存，但会明确提醒缺少正文。

按保存返回的 `nextStep` 调用 `own_read_conversation`，对照原本计划保存的内容核对数量，并查看正文末尾及重要代码、表格和行动项。分页读取应继续到 `nextOffset: null`；`includeOriginal: true` 可返回最初提交的完整 Markdown。幂等重试返回当前核对状态，不会掩盖后续修改或补回用户删除的卡片。核对范围是 **实际提交给服务的内容**，无法判断 agent 上下文中哪些信息没有传入。

客户端中点击卡片底部的「阅读会话」，可按目录连续阅读整份记录，包括长正文、任务状态及负责人、公式和图；普通富文本卡片提供「阅读全文」。长内容不受画布卡片高度限制。「导出正文原稿」保留最初传入的 Markdown，额外结构化行动项和图仍在阅读视图中。旧会话也可按原有卡片顺序阅读，未增加核对清单的旧数据不会被重新排布或改写。

## 工具

| 工具                    | 用途                                                   |
| ----------------------- | ------------------------------------------------------ |
| `own_list_boards`       | 按项目名查找画布，默认返回摘要，支持 offset / limit    |
| `own_search`            | 搜索文字、任务、表格、公式及图源码，返回片段和定位链接 |
| `own_read_board`        | 分页读取卡片，附 `contentHash` 和会话来源              |
| `own_read_conversation` | 按 `requestId` 分页读回整份会话与核对结果，可读原稿   |
| `own_save_conversation` | 原子追加整组会话笔记，支持幂等重试                     |
| `own_add_note`          | 追加 Markdown、文字、待办或表格                        |
| `own_add_latex`         | 校验并追加 LaTeX 公式及解释                            |
| `own_add_diagram`       | 校验并追加 Mermaid 图及说明                            |
| `own_add_chart`         | 追加柱状图、折线图或饼图及原始数据                     |
| `own_update_note`       | 用 `expectedHash` 更新一张卡片，冲突时拒绝覆盖         |
| `own_add_code`          | 保存多语言代码单元、标准输入与预期输出，手动运行       |
| `own_add_analysis`      | 校验并完整保存 CSV / TSV / JSON 数据分析笔记           |
| `own_publish_plan`      | 发布公开方案、任务要求、验收标准和依赖                 |
| `own_agent_next`        | 发送心跳并领取最新待实现笔记及版本凭证                 |
| `own_agent_report`      | 报告进度、阻塞、完成证据，检测用户修改                 |
| `own_agent_status`      | 读取实际上报的 Agent 状态与构想笔记                   |

另有 `own://guide` 整理指南、`own://boards` 画布目录、`own://boards/{boardId}` 画布元信息资源，以及 `organize_conversation` 提示模板。工具的完整输入结构可通过 MCP `tools/list` 发现。

## 公式、图与数据

LaTeX 是 KaTeX 数学公式工具，输入不带 `$$` 的公式源码，支持 12000 字符及通俗说明。不是完整 TeX 文档编译器。Markdown 内也支持 `$...$` 和 `$$...$$`。

Mermaid 支持流程图、时序图、类图、状态图、ER 图、思维导图、时间线、甘特图、饼图。输入纯源码，最长 20000 字符。不支持 init、frontmatter、HTML、点击回调、脚本或外部资源。保存前验证语法；浏览器以 strict 模式渲染并清理 SVG。公式、图或数据有误时整次会话写入失败，不留下半份结果。

数据图表结构：

```json
{
  "type": "bar",
  "labels": ["第一周", "第二周"],
  "series": [{ "name": "已完成", "values": [3, 5], "color": "#5266d4" }],
  "unit": "项"
}
```

`type` 支持 `bar` / `line` / `pie`。每组值与标签一一对应，最多 60 个标签、6 组有限数值。饼图只能有一组非负数据，且不全为零。图上可展开精确原始数据；Mermaid 和数据图表可导出 SVG。图表必须来自真实数据或明确标注为示例，caption 应说明结论及来源。

用户可以通过「添加内容」创建这些卡片，双击打开源码编辑器及阅读预览；点击「阅读全文」可进入独立阅读视图。卡片支持调整颜色、拖动、缩放、搜索和备份。Markdown 导出保留公式、Mermaid 源码和图表数据表。

## 保存与同步

本机 HTTP 只监听 loopback，校验 Host / Origin，无跨站 CORS。MCP 请求最大 4 MB，笔记工作空间最大 20 MB。保存文件仍为 `data/notebook.json`，附件路径不变。

保存成功后，服务通过 SSE 立即通知页面读取最新版本，每 3 秒的版本检查作为断线兜底。页面空闲时采用最新内容并清空旧撤销历史，编辑期间暂缓替换。保存遇到远端更新时，以编辑前版本进行三方合并：独立笔记或字段的更改和 Agent 心跳可合并；同一字段的不同修改会拒绝覆盖。点击「接收更新」可加载最新版，未保存内容保留在恢复副本中。`own_update_note` 仍要求最新 `contentHash`；构想任务要求由用户编辑，Agent 使用 `own_agent_report` 写入进展和结果。

## Next to do 协议

`own_publish_plan` 接受 `boardId`、`requestId`、`agentId`、`agentName?`、`title`、完整 `markdown` 和 `tasks`。每项任务包含临时 `id`、`title`、`markdown`、`acceptance`、`dependsOn`。依赖用该批任务的临时 ID，服务转为持久笔记 ID。最多 100 个任务；重复或不存在的依赖和循环依赖会使整次发布失败。

```json
{
  "boardId": "从 own_list_boards 获取",
  "requestId": "plan-001",
  "agentId": "my-agent",
  "title": "实现学习示例",
  "markdown": "## 方案\n先保存源码、输入与要求，再验证真实输出。",
  "tasks": [
    { "id": "build", "title": "创建示例", "markdown": "保留所有输入。", "acceptance": "输入 3、5、8，输出 16。", "dependsOn": [] },
    { "id": "test", "title": "验证示例", "markdown": "读回并检查输出。", "acceptance": "给出实际结果。", "dependsOn": ["build"] }
  ]
}
```

然后调用 `own_agent_next({boardId, agentId})`。`status: running` 返回当前 `note`、`leaseToken`、`revision`；只执行这个版本。至少每 30 秒以及关键动作前后调用 `own_agent_report({boardId, agentId, noteId, leaseToken, revision, status, progress, evidence?})`。完成需 `status: done` 和真实 `evidence`；阻塞时用 `blocked`。修改、暂停、删除、依赖重新打开或 120 秒凭证过期后，旧报告返回 `needsReplan: true`，必须重新领取。没有任务时返回 `waiting`，工具不会替客户端安排自动继续。

状态以实际上报为准，75 秒内心跳显示在线。任务公开展示方案、要求、进展、证据及修改记录，不要求或输出隐藏推理。仅配置 MCP 不会暴露客户端内部 todo。详细行为见 [工作台说明](workbench.md)。

## 验证

`npm test` 使用官方 MCP Client 连接临时 HTTP 服务及真实 stdio 子进程，验证初始化、发现、资源、提示、整理落盘、幂等重试、并发、冲突、语法与数据验证、搜索及卡片更新。临时测试工作空间与用户笔记隔离。`npm run build` 检查 TypeScript 并构建生产资源。
