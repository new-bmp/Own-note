# Own Windows 客户端

推荐运行 **Own-Setup.exe** 安装，随后从开始菜单或桌面快捷方式打开 Own。安装到当前用户，无需管理员权限，在 Windows「设置 → 应用」中可卸载。升级时先保存并关闭所有 Own 窗口，再运行新安装程序。

也可解压整个 `Own-win-x64.zip`，双击文件夹里的 **Own.exe** 使用便携版。窗口使用 Windows 原生 WebView2，应用会自动启动和关闭随包附带的 Node.js 服务，不需要打开浏览器、终端，也不需要另装 Node.js 或 .NET。

支持 Windows 10/11 x64。需要微软 WebView2 Evergreen Runtime（Windows 11 通常已内置）；如缺失，客户端会提供微软官方下载入口。本版本不包含 macOS/Linux 客户端。

## 笔记与窗口

- 笔记与附件保存在 `%LOCALAPPDATA%\Own\workspace`，WebView 缓存保存在 `%LOCALAPPDATA%\Own\WebView2`。移动或更新程序文件夹不会删除笔记。
- 安装目录为 `%LOCALAPPDATA%\Programs\Own`。卸载仅删除程序与安装时创建的快捷方式，笔记、附件、配色和窗口设置保留，重新安装后可继续使用。安装包不包含开发目录或其他用户的笔记。
- 开发目录首次启动客户端时，会将原 `data/` 的笔记和附件复制到空的客户端工作空间，原文件保留。已有客户端笔记不会被覆盖；其他位置的旧笔记可通过「完整备份」导入。
- 「文件 → 打开数据文件夹」打开当前笔记目录。应用会记住窗口位置和最大化状态；支持系统 DPI 缩放、拖放文件、剪贴板粘贴和原生文件选择/保存对话框。
- 关闭窗口前会保存最新编辑。公式、图或快速记录等编辑窗口仍打开时，会先询问是否放弃草稿；保存失败会保留窗口。
- 完整备份使用 `.own` 扩展名；旧版 `.fieldnotes` 备份仍可导入。
- 重复启动同一工作空间会激活已有窗口。链接到外部网站时使用系统默认应用；画布、公式、图表、附件预览和编辑均在 Own 内完成。
- 界面和公式字体使用本机及随包资源，不从在线字体服务加载。

## 文件与图形输入

- 文件或整个文件夹可直接拖到画布。文件夹以可浏览卡片保存，可搜索、进入子目录、预览、将单文件抽到画布，或导出 ZIP；完整备份包含文件夹中的所有附件。导入会显示进度和失败条目，成功部分始终保留。
- 支持图片、PDF、音视频、文本、代码、Markdown、LaTeX 和 Mermaid 预览，以及 DOCX / XLSX / PPTX 的文字与表格内容预览。Office 原始排版和其他格式可另存为，或点击「用系统应用打开」。系统应用打开的是临时副本，修改不会自动回写笔记，需要重新导入。
- 任意文件格式均可保存；单文件上限 100 MB。文本预览最多 1 MB，Office 内容预览最多读取 50 MB 的压缩文件；这些限制不影响已保存的原始文件。文件夹 ZIP 导出最多 250 MB，较大资料使用完整备份。
- 选中卡片，从四侧连接点拖到另一张卡片可创建关系；点击线条编辑文字、走线、箭头、虚线及颜色。C 仍支持依次点击两张卡片连接。
- 工具栏提供「公式输入器」和「流程图制作器」。公式支持可视输入、数学键盘和结构按钮；流程图用节点与关系表单制作，右侧实时预览。两者都保留源码模式，Ctrl + Enter 保存。字体与编辑器资源随包提供。

## Agent / MCP

1.3 版增加可编辑数据表、图表制作和真实单步调试。安装程序默认带 Node.js、Python、GCC/G++、GDB，Java、Go、Rust 可选；工具不修改系统 PATH。左侧「Agent Next to do」使用独立项目，需让连接客户端使用协作协议，支持修改未实现笔记后重新领取任务。[工作台说明](workbench.md)列出了输入方式、支持格式和运行限制；[工具链说明](toolchains.md)列出了组件来源。

打开 Own 后，从左侧「连接 Agent」复制当前配置，MCP 会直接写入客户端正在显示的笔记；更新通过流式事件显示。保持 Own 窗口运行即可，无需单独启动服务。默认地址为 `http://127.0.0.1:5173/mcp`；端口被其他程序占用时自动选择可用端口，以界面显示的连接地址为准。

stdio 配置会自动使用随包的 `runtime/node.exe` 和 `app/mcp-stdio.mjs`。所有 MCP 客户端仍通过同一个本机服务写入，保留版本冲突检查。关闭 Own 后其自启服务也会结束；复用的外部 Own 服务不会被客户端停止。

「连接 Agent」里可以复制完整整理要求。会话支持完整 Markdown 自动拆卡、保存后内容核对和按目录连续阅读；点击卡片底部的「阅读会话」即可通读正文、行动项、公式与图。升级后让 agent 客户端重新连接 MCP，以发现新增的 `own_read_conversation` 工具。

## 从源码运行和打包

开发机需要 Node.js 22.18+、.NET 10 SDK 和 Windows WebView2 Runtime：

```powershell
npm install
npm run desktop
```

`npm run desktop:dev` 在原生窗口中启用 Vite 热更新。

```powershell
npm run desktop:package
npm run desktop:installer
```

输出 `release/Own-win-x64/Own.exe` 和 `release/Own-win-x64.zip`。打包内容包括自包含 .NET 客户端、WebView2 加载器、Node.js、前端构建和生产依赖；不会包含开发目录的个人笔记、附件或视频。

`desktop:installer` 会在独立的 `release/Own-app-win-x64` 目录构建程序资源，再生成单文件安装程序 `release/Own-Setup.exe` 及 SHA-256 校验文件。它不替换正在使用的便携版目录。编译器随开发依赖安装；若已有 Inno Setup 6.3+，也可用 `OWN_ISCC` 指定 `ISCC.exe`。只重新封装已完成的安装资源可用 `npm run desktop:installer -- --from-package`。

`npm run test:installer` 在独立测试身份和临时目录中实际安装、覆盖升级、调用随包 Node.js / MCP 保存并读回记录，再验证卸载保留工作空间、删除快捷方式及卸载项。测试不打开应用窗口。

调试可直接向 `Own.exe` 传入 `--app-root`、`--node`、`--data-dir`、`--profile-dir`、`--state-dir`、`--port`（0 表示自动选择）及 `--dev`。也可用 `FIELDNOTES_DATA_DIR` 指定工作空间。调试独立工作空间时应同时指定独立的 profile 和 state 目录。
