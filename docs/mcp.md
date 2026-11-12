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

| 工具 | 用途 |
| --- | --- |
| `own_capabilities` | 发现功能、运行环境与调用示例 |
| `own_list_agent_projects` | 查找独立 Agent 项目 |
| `own_create_agent_project` | 创建含目标与边界的长期项目 |
| `own_read_agent_project` | 恢复目标、约束与工作上下文 |
| `own_publish_plan` | 发布公开方案与任务 |
| `own_agent_next` | 领取最新待办与发送心跳 |
| `own_agent_report` | 报告进展、阻塞与验证证据 |
| `own_agent_checkpoint` | 保存完整工作与交接记录 |
| `own_agent_status` | 读取实际心跳与任务状态 |
| `own_list_boards` | 查找项目画布 |
| `own_search` | 搜索笔记与源码 |
| `own_read_board` | 分页读取笔记与关系 |
| `own_read_note` | 完整读取单张笔记与版本 |
| `own_read_conversation` | 读取并核对完整会话 |
| `own_save_conversation` | 整理并保存完整会话 |
| `own_add_note` | 添加笔记、表格与待办 |
| `own_add_latex` | 添加 LaTeX 公式 |
| `own_add_diagram` | 添加 Mermaid 图 |
| `own_add_chart` | 用数值或数据表添加图表 |
| `own_update_note` | 按版本更新内容、设置和布局 |
| `own_add_code` | 保存多语言代码与输入输出示例 |
| `own_run_code` | 显式运行代码并保存真实结果 |
| `own_start_debug` | 开始真实单步调试 |
| `own_lab_result` | 读取流式输出、变量与保存结果 |
| `own_debug_command` | 单步、调用栈、断点与停止 |
| `own_add_analysis` | 保存完整原始分析数据 |
| `own_analyze_data` | 筛选、排序、统计与聚合 |
| `own_chart_from_analysis` | 从真实分析保存可追溯图表 |
| `own_upload_asset` | 分块上传与校验任意文件 |
| `own_add_attachment` | 保存文件、文件夹、媒体与模型 |
| `own_read_attachment` | 浏览目录与无损读取文件 |
| `own_convert_media` | 显式转换媒体为兼容格式 |
| `own_save_media_result` | 将转换结果保存为永久笔记 |
| `own_connect_notes` | 创建笔记之间的关系 |
| `own_update_connection` | 按版本修改关系样式 |

共35个工具。`own_capabilities({feature})` 按功能返回工具、步骤、示例和恢复指引；`tools/list` 提供完整参数。资源包括 `own://guide`、`own://capabilities`、`own://boards`、`own://boards/{boardId}`、`own://agent-projects`、`own://agent-projects/{projectId}`。提示模板包括 `organize_conversation` 和 `resume_agent_project`。HTTP和stdio提供相同功能。

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

## 长期 Agent 工作
Next to do 是独立于画布的长期工作模式。连接后先 own_capabilities（feature: agent），用 own_list_agent_projects 定位授权项目，own_read_agent_project 读取目标、范围、约束、验收标准与完整任务；按 nextOffset 读完，公开方案和工作记录用 own_read_note 完整读取。没有项目才 own_create_agent_project，写清 goal、scope、constraints、acceptance。

own_publish_plan 发布可供人理解的完整公开方案、任务、验收和依赖。每批 requestId 唯一，重试保持参数不变；不覆盖用户编辑过的方案和任务。own_agent_next 领取最新任务，返回 brief、revision、leaseToken、两分钟有效期与交接入口。执行前、关键操作后及至少每30秒 own_agent_report；needsReplan=true 时停止旧方案，重新读取项目并领取。用户修改方案/项目约束/任务会撤销旧凭证，整个项目暂停时停止领取和写入。

长任务必须持续留下可恢复记录：用 own_agent_checkpoint 保存完整 Markdown，包括已完成、决定和公开依据、未完成、下一步、阻塞、验证与 artifactIds。重连先 read_agent_project，读 contextNotes 中最近工作记录，再领取；不能仅凭上一次聊天记忆继续。只公开方案、依据和执行事实，不输出隐藏推理。own_agent_report 的 nextAction、blockers、artifactIds 应随实际工作更新；done 必须附真实 evidence，不能把计划说成实现。

Own 在内部代码、调试和媒体执行中强制验证 execution（taskId、agentId、leaseToken、revision）、项目暂停和执行开关。暂停或修改约束会停止关联运行。文字工作范围和外部操作仍需协作 Agent 遵守，Own 无法读取任意客户端内部 todo 或撤回其外部动作；配置连接不等于在线，在线只来自真实心跳。不要在笔记中保存执行令牌，不扩大用户原本授权。

## 新功能的完整工作流程
所有笔记工具接受 boardId 或 projectId，二者选一。先 own_read_note 获取 note、单元ID与 contentHash，再用 own_update_note 和 expectedHash 条件更新；冲突后重读，不自动覆盖。更新还支持位置/大小、代码单元、表格、分析数据与设置、mediaSettings、modelSettings。

- 代码：own_add_code 保存多语言 cells（language、code、stdin、expected）；own_run_code 显式运行一个已保存单元，own_lab_result 读取流式stdout/stderr和是否保存。相同 requestId 重试不重跑；最近1000条执行受理记录持久保存，服务重启后旧请求会要求核查结果，不自动重跑。运行进程与未保存的输出不会跨重启恢复。用户改源码或有更新运行时，旧结果不写回；保存工具本身不执行代码。own_start_debug 开始真实 JS/TS/Python/C/C++ 调试；own_debug_command 的 next/step/out/continue/pause/frame/configure/stop 控制执行，own_lab_result 查看真实行、变量、观察、调用栈。运行语言与可用工具链先看 own_capabilities.runtime，编辑语言不一定可执行。
- 分析：own_add_analysis 保存完整CSV/TSV/JSON；own_analyze_data 返回列、原始行号、分页筛选结果、统计和分组。settings 的 group/value/filter.column/sort.column 是从0开始的列索引，返回行号从1开始且不含表头。own_chart_from_analysis 使用 expectedHash 和设置从真实原始数据制图，保存来源hash、计算方式、行数；超过60组会注明。own_add_chart 也可直接传 grid（第一行表头、第一列类别）。
- 文件：own_upload_asset start(filename,size,sha256,requestId,mime) → chunk(uploadId,offset,data为Base64) → commit(uploadId)；每块最多256KB、单文件100MB，乱序或SHA错误会拒绝。重试start和chunk保持相同参数，commit可重试。服务重启后未完成上传需重新start。own_add_attachment 使用 assetId 保存任意文件，folder.entries 传相对路径与已上传ID，自动补父目录、保留空目录；模型的贴图/缓冲文件一同导入，modelPath 选择主模型。own_read_attachment 分页浏览目录或按字节读取原文件，读到nextOffset=null可按SHA无损核验。
- 媒体和3D：附件按文件名进入对应查看器。mediaSettings={speed:1,volume:1,loop:false,start:0,marks:[{time:12,label:'关键说明'}]}；modelSettings={wireframe:false,grid:true,autoRotate:false}，可创建时传入或条件更新，客户端查看器实际应用。own_convert_media 显式转换为MP3/MP4，own_lab_result 等待success后 own_save_media_result 将缓存结果保存为永久附件；并非所有编码都能解码，失败不修改原文件。
- 关系：own_connect_notes 保存标签、curve/straight/elbow、箭头、虚线、颜色和连接侧；own_read_board.connections 取hash后 own_update_connection。视觉连线不改变任务依赖，任务依赖来自 publish_plan。
- 表达：own_add_note、own_add_latex、own_add_diagram 和 own_add_chart 均可保存到独立项目。公式传KaTeX源码，图传纯Mermaid源码；读回核对内容、单位与来源。

## 验证

`npm test` 使用官方 MCP Client 连接临时 HTTP 服务及真实 stdio 子进程，验证初始化、发现、资源、提示、整理落盘、幂等重试、并发、冲突、语法与数据验证、搜索及卡片更新。临时测试工作空间与用户笔记隔离。`npm run build` 检查 TypeScript 并构建生产资源。

## 子画布与演讲

`own_create_board({requestId,title,parentBoardId?,description?,x?,y?})` 创建画布。指定 `parentBoardId` 时原子创建下级与上级入口；省略创建根画布。返回 `boardId`、`parentBoardId`、`portalNoteId`，后续笔记工具用新的 `boardId`。相同 requestId 和参数重试不重复创建，参数变化会拒绝。子画布支持继续嵌套，共用工作空间及原始附件 ID。

`own_list_boards({parentBoardId})` 查直接下级，省略查全部层级；`own_read_board` 返回 `path`、`childBoards` 和入口笔记的 `childBoardId`。`own_capabilities({feature:"canvas"})` 返回示例。层级不能循环，入口不能跨上级，删除入口保留下级。演讲仅在客户端进入，内容只读，临时布局不落盘；MCP 写入仍作用于正式笔记，已打开的演讲快照不会被远端更新打断。
