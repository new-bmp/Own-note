# 随包语言工具

Own 1.3 的 Windows 安装程序默认选择 Node.js、Python、GCC/G++ 和 GDB。Java、Go、Rust 在“自定义组件”中选装，也可选择“全部语言工具”。安装后运行这些语言无需联网；未选择的语言可重新运行同一安装程序补装。

工具只保存在 Own 的 `runtime/toolchains` 目录。Own 优先使用这些工具，不修改用户 PATH 或已有 Python、Java 和编译器配置。Rust 使用 Windows GNU 目标，并带上所需的 GCC 链接工具。Node.js 由客户端运行时提供。Python 是官方嵌入式发行版，支持标准库，不预装 pip 和第三方分析包。

| 组件 | 发行来源 | 随包信息 |
| --- | --- | --- |
| Node.js | https://nodejs.org/ | `runtime/NODE-LICENSE.txt` |
| Python | https://www.python.org/ | `python/LICENSE.txt` |
| GCC / G++ / GDB | https://winlibs.com/ | `mingw` 内的版权与许可文件 |
| OpenJDK | https://adoptium.net/temurin/releases/ | `java/legal` 与 `java/NOTICE` |
| Go | https://go.dev/dl/ | `go/LICENSE`、`go/PATENTS` |
| Rust | https://www.rust-lang.org/tools/install | `rust` 内各组件的 LICENSE 与 COPYRIGHT |

每个组件的 `own-toolchain.json` 保存准确版本、官方归档地址和 SHA-256；`manifest.json` 汇总发行信息。构建脚本下载后核验摘要，再解压到 `.toolchains` 缓存。归档、运行时和下载缓存都不提交 Git。

构建环境能直接访问源站时运行 `node scripts/toolchains.mjs`。需要国内镜像时，在该命令的进程环境中设 `OWN_TOOLCHAIN_MIRROR=cn`：GitHub 归档使用 ghfast，Python 使用 npmmirror，Rust 使用 rsproxy，仍核验官方发行摘要。Rust 发行清单本身也与官方提供的 SHA-256 核对。

单步调试支持 JavaScript / TypeScript（Node inspector）、Python（逐行跟踪）和 C / C++（GDB）。Java、Go、Rust 当前提供完整程序运行和输入输出记录。每个代码单元独立运行，不共享变量；变量面板显示当前调试会话的暂停位置。
