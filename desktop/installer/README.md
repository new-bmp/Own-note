# Own 安装程序

`Own.iss` 使用 Inno Setup 6.3+ 构建当前用户安装包。默认编译器由锁定版本的开发依赖 `innosetup-compiler` 提供，也可通过 `OWN_ISCC` 指定本机 `ISCC.exe`。

简体中文消息来自 Inno Setup 源码的 `is-6_3_1` 标签，保留原有译者说明：

https://github.com/jrsoftware/issrc/blob/is-6_3_1/Files/Languages/Unofficial/ChineseSimplified.isl

安装包只接收已经完成的 `release/Own-app-win-x64` 生产目录。它与便携版目录独立，便于便携版运行期间生成安装程序。应用安装到 `%LOCALAPPDATA%\Programs\Own`，笔记仍在 `%LOCALAPPDATA%\Own\workspace`，卸载不会删除笔记和附件。

`InstallerTest` 编译开关使用独立的应用 ID、快捷方式和卸载项，供 `npm run test:installer` 验证真实安装、升级、MCP 读写及卸载流程，不会覆盖正式安装。
