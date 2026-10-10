# Build HarmonyOS Apps：官方能力与复用研究

> 研究阶段与实际验收分开记录。本文件中“未启动/未验证”描述研究代理当时的只读阶段；后续已完成的本机结果以 [validation.md](validation.md) 为准。

核验日期：2026-10-09。范围是本机 DevEco CLI、Codex 插件包规范、macOS ScreenCaptureKit，以及 `serve-sim` / `dsh-hos-scrcpy` 的复用边界。没有安装软件、启动服务或模拟器，也没有接受协议。

## 结论

1. **直接复用 DevEco CLI 做工程与设备操作。** 华为开发者官网将 `@deveco/deveco-cli` 作为官方 DevEco CLI 发布，称其提供工具集、官方知识库、Skills，以及工程创建、语法检查、构建和运行能力。官网列出的安装包名与本机包一致。[华为 DevEco Studio/CLI](https://developer.huawei.com/consumer/cn/deveco-studio)

2. **不要把 `devecocli serve mcp` 当设备控制服务。** 本机安装的是 CLI 1.3.0。`devecocli --help` 暴露 `build/run/device/emulator/ui/log/skills/init/serve`；它的 `ui` 子命令覆盖截图、布局树、点按、滑动、输入；CLI 随附的 `deveco-cli` Skill 已说明常用工作流。本机 CLI README（`@deveco/deveco-cli/README.md`，位于本机 npm 全局安装目录） 本机 CLI Skill（`@deveco/deveco-cli/SKILL.md`，位于本机 npm 全局安装目录）

   **本机包文档事实：** `serve mcp` 是 stdio MCP，列出的工具为 ArkTS/C++ 的 `check`、LSP 查询（如 `hover`、`definition`、`references`、`documentSymbol`、`callHierarchy`）和 `restart`；部分 LSP 工具依赖 DevEco Studio 提供的 LSP。清单不包含设备发现、截图、触控、HAP 安装或日志工具。因此 `serve-hos` 应提供自己的浏览器/MCP 设备层，开发工作流调用既有 CLI；只有需要代码诊断时才单独配置 `deveco-mcp`。本机 CLI README 的 `serve mcp` 表格（`@deveco/deveco-cli/README.md`，位于本机 npm 全局安装目录）

3. **HDC 截图轮询有官方记录。** 华为官方截图指南给出 `hdc shell snapshot_display -f /data/local/tmp/0.jpeg`，再用 `hdc file recv` 拉回主机。DevEco CLI 的截图封装也采用 `snapshot_display` 与 `hdc file recv`。这支持低帧率预览降级；官方资料没有由此证明可持续取得视频流。[华为官方截屏文档](https://developer.huawei.com/consumer/cn/doc/doccenter-deveco-studio/ide-hmos-screenshot)

4. **ScreenCaptureKit 提供适合捕获 DevEco 模拟器窗口的单窗 API，最小化时需降级。** Apple 提供 `SCContentFilter(desktopIndependentWindow:)` 单窗过滤；WWDC 资料说明被遮挡或移出屏幕的窗仍可输出完整内容，但最小化时流会暂停，恢复后继续。macOS 首次授权 Screen Recording 后，Apple 示例要求重启捕获进程才能开始捕获。实际 DevEco 模拟器窗口是否能被枚举和捕获仍需本机验证。[单窗过滤 API](https://developer.apple.com/documentation/screencapturekit/sccontentfilter) [Apple WWDC22 窗口捕获行为](https://developer.apple.com/videos/play/wwdc2022/10155/) [Apple ScreenCaptureKit 示例与权限](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos)

5. **优先借鉴 `serve-sim` 的整体形状；慎重打包 HOScrcpy 二进制。** `serve-sim` 是 Apache-2.0，已经实现本机预览页、视频/控制通道和 Swift 辅助进程；但它捕获 iOS Simulator 的 `simctl` framebuffer，要求 macOS、Xcode CLI 和 Apple Silicon，不能直接控制 HarmonyOS 模拟器。GitHub 页面显示 171 次提交，README 已记录 Xcode 27/iOS 27 模拟器行为；这是持续维护迹象，不构成后续兼容保证。[serve-sim 上游](https://github.com/EvanBacon/serve-sim)

   `dsh-hos-scrcpy` 仓库声明自有代码为 MIT，使用 HDC 与 Java sidecar 提供 HarmonyOS 手机/平板的 H.264、触控和按键能力，但宿主集成依赖 DSH core；其 Demo 在开发目录，不随 npm 包发布。GitHub 页面显示 12 次提交、5 颗星，体量/采用度远小于 `serve-sim`；提交数和星数只能作为项目规模与外部采用的粗略信号，不能证明是否仍维护。仓库的第三方声明称上游 HOScrcpy LICENSE 版权人仍是 `[year] [fullname]` 占位符，且 JAR 内含设备侧 `.so`。这是该插件维护者的声明，尚未独立核实；适合学习协议与架构，暂不应把 JAR 当作许可证已完整核实的可再分发依赖。[dsh-hos-scrcpy 上游](https://github.com/ns-zzj/dsh-hos-scrcpy) [其第三方声明](https://github.com/ns-zzj/dsh-hos-scrcpy/blob/main/THIRD_PARTY_NOTICES.md)

## 已核实细节

### Huawei DevEco CLI、Skills 与 MCP

- 华为官网将 DevEco CLI 标为官方开发工具，说明其集成 HarmonyOS 知识库与精品 Skills，并提供 CLI 安装指令。官网另说明 DevEco Studio 有设备投屏能力，支持点击、滑动、键盘输入；DevEco Testing 的 UIViewer 提供设备镜像和控件查看。这些产品能力不能推导出一个可供第三方调用的公开视频流 SDK。[DevEco CLI 与 Studio](https://developer.huawei.com/consumer/cn/deveco-studio) [DevEco Testing UIViewer](https://developer.huawei.com/consumer/cn/deveco-testing/)
- 华为 DevEco Studio 26.0.0 发布说明写明模拟器支持命令行获取 UI 布局、点击、滑动和文本输入。[官方版本说明](https://developer.huawei.com/consumer/en/doc/harmonyos-releases/deveco-studio-new-features-2600)
- 本机 CLI 版本为 **1.3.0**（`package.json` 和 `devecocli --version`），而 npm registry 的已发布版本记录中可见 **1.3.4**；本次未升级，因此只将本机 1.3.0 的 help 与随包文档作为行为证据。本机 package.json（`@deveco/deveco-cli/package.json`，位于本机 npm 全局安装目录） [npm 包版本页](https://www.npmjs.com/package/@deveco/deveco-cli)
- CLI 有 `skills list/find/add/remove` 与 `init --skill`；`init --mcp` 配置的是上述工程语言 MCP。已安装的 `SKILL.md` 可以沿用，插件可只补充 HarmonyOS 专属流程与 serve-hos 的启动、诊断和预览指引，避免复制 CLI 的构建/运行说明。
- 未在已查阅的华为官方资料中找到 DevEco 模拟器的公开实时视频流 API；这只表示此次检索没有找到公开接口，不是证明接口绝不存在。可验证的实现路径是 ScreenCaptureKit 捕获主机模拟器窗口，并用 HDC 截图轮询做降级。

### OpenAI Codex 插件规范

- OpenAI 当前推荐的可移植插件布局是根目录 `plugin.json`、`skills/` 和可选的根目录 `mcp.json`；OpenAI 专属 UI/扩展字段放进 `extensions.com.openai`。`.codex-plugin/plugin.json` 是受支持的 Codex 兼容格式/回退。便携格式的 MCP 清单和 Codex 兼容 `.mcp.json` 不是简单改名关系。[OpenAI 插件打包规范](https://developers.openai.com/plugins/build/plugins)
- 本机缓存的 `build-ios-apps` 0.1.2 是当前目标的直接样例：`.codex-plugin/plugin.json` 指定 `skills: "./skills/"` 与 `mcpServers: "./.mcp.json"`；`.mcp.json` 以 `mcpServers` 映射 `command` / `args` / `env`。本机样例文件：`build-ios-apps/0.1.2/.codex-plugin/plugin.json` 与 `.mcp.json`（宿主插件缓存内）。
- OpenAI 文档规定本地仓库插件目录使用 `$REPO_ROOT/.agents/plugins/marketplace.json`，每个条目通过相对 marketplace 根目录的 `source.path` 指向插件目录；本机 Codex CLI 帮助确认支持 `codex plugin marketplace add <path>`、`codex plugin add <plugin@marketplace>`。本地插件是合适的开发/测试入口。[OpenAI 本地 marketplace 与 CLI](https://developers.openai.com/plugins/build/plugins) [本机 Codex CLI 帮助](本机只读执行：`codex plugin --help`、`codex plugin marketplace add --help`、`codex plugin add --help`)
- 如果后续提交公共插件目录，OpenAI 当前要求本地运行 MCP 服务部署到 HTTPS 端点；这不影响当前 macOS 本地插件方案。[OpenAI MCP 服务器打包说明](https://developers.openai.com/plugins/build/plugins)

### ScreenCaptureKit 权限、遮挡与坐标

- Apple 框架文档指出需要先向用户请求 Screen Recording 权限，并为应用提供 `NSScreenCaptureUsageDescription`；捕获失败可通过 ScreenCaptureKit 的授权错误识别。Apple 当前 macOS 示例第一次运行会触发系统授权提示，授权后必须重启应用才能开始捕获。[框架权限说明](https://developer.apple.com/documentation/screencapturekit) [首次授权示例](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos)
- `SCWindow` 表示可捕获窗口，公开 `frame` / `isOnScreen`；`SCContentFilter` 提供 `contentRect`（屏幕点）与 `pointPixelScale`（点到像素缩放）。WWDC22 说明单窗捕获不受其他窗遮挡影响，最小化会暂停 stream。[SCWindow](https://developer.apple.com/documentation/screencapturekit/scwindow) [SCContentFilter 坐标字段](https://developer.apple.com/documentation/screencapturekit/sccontentfilter) [WWDC22](https://developer.apple.com/videos/play/wwdc2022/10155/)
- **实现推断，需本机模拟器验收：** 浏览器坐标先归一化到截取后“设备显示区域”，再根据设备实际分辨率映射到 DevEco CLI/HDC 的设备坐标；避免把 macOS 窗口 frame 直接当成设备坐标。过滤器内容可能包含窗口周边区域，网页又可能缩放、留白，设备旋转也会改变方向，因此需要以一张 HDC 设备截图和窗口帧的内容矩形做一次映射校准。最小化时切到 `snapshot_display` 轮询，并在恢复后重新启用/确认窗口 stream。
- Apple 示例项目明确要求 macOS 15+ 与 Xcode 16+；这是该示例的构建要求，不应误读为 ScreenCaptureKit 框架的最低系统版本。[Apple 示例要求](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos)

## 建议给实现的复用边界

| 需求 | 建议复用/实现 | 证据性质 |
|---|---|---|
| 构建、部署、启动、模拟器/设备发现、UI 树/点按/滑动/文本、Hilog | 调用已安装的 `devecocli`；复用其 Skill 指引 | 华为官方能力说明 + 本机 1.3.0 CLI help/Skill |
| 低帧率屏幕预览 | HDC `snapshot_display` + `file recv` 定时轮询 | 华为官方文档 |
| 本机模拟器实时预览 | ScreenCaptureKit 单窗流；实现权限提示、最小化暂停处理与设备区域坐标映射 | Apple API 事实 + 尚待本机验证的实现推断 |
| Codex 工具入口 | 保留 `build-ios-apps` 的 `.codex-plugin/plugin.json` / `.mcp.json` 模式，或同时增加官方可移植 root manifest | OpenAI 官方规范 + 本机样例 |
| HOScrcpy 传输 | 参考 H.264/WebSocket 与设备状态设计；不要直接 vendoring 未核实署名的 JAR | 第三方仓库自述；许可状态待上游确认 |
| `serve-sim` | 参考本地 HTTP 页面、视频流和控制通道的架构 | Apache-2.0 上游；平台实现不适用于 HOS |

## 补充核验：ArkUI Skill 许可与 DevEco CLI 构建退出码

核验日期：2026-10-09。本段记录单个 Skill 的官方安装与保存，以及本机 CLI 1.3.0 的构建失败传播路径。

### 官方 Skill 包与许可

- 官方源仓库为 [HarmonyOS_Skills/harmonyos-agent-skills](https://gitcode.com/HarmonyOS_Skills/harmonyos-agent-skills)。GitCode 内容 API 的 [`LICENSE`（main）](https://gitcode.com/api/v5/repos/HarmonyOS_Skills/harmonyos-agent-skills/contents/LICENSE?ref=main) 返回完整 MIT License，版权行为 `Copyright (c) 2026 Huawei Device Co., Ltd.`；API 内容 1080 字节，GitCode blob SHA-1 为 `cf861abf2c04b3ff04c6783ea190efc73a7a9055`。
- `devecocli skills add --help` 将 `--path <path>` 描述为直接安装路径，并说明不能与 `--project` / `--agent` 同用。该路径必须预先存在；首次安装因目录不存在而失败，创建专用目录后重试成功，没有使用 `--force`。
- 官方 CLI 1.3.0 从 [HarmonyOS Skills 注册表](https://matrix.openharmony.cn/api/registry/skill/skills) 安装唯一目标 `hmos-arkui-develop-skill`，注册表版本为 `1.1.1`。对应的[安装包接口](https://matrix.openharmony.cn/api/registry/skill/hmos-arkui-develop-skill/install?format=zip)及[校验和接口](https://matrix.openharmony.cn/api/registry/skill/hmos-arkui-develop-skill/checksum)给出的包 SHA-256 为 `b11b85a8aecfb4c0743b254de9bd98183cd218f6cf988731ffa5d46393fa15e1`，压缩包大小 99,960 字节（checksum 记录时间 2026-10-08 18:29:53）。CLI 安装实现会校验下载包大小与 SHA-256；本次安装成功。本地包含 38 个文件、约 316 KiB，包括 `SKILL.md`、ArkUI API/规则参考和代码生成案例。
- 专用下载目录为 `work/official-skills/hmos-arkui-develop-skill/`；完整目录复制至插件的 `skills/hmos-arkui-develop-skill/`。`diff -qr` 验证两目录一致。MIT 文本写入该仓库 `docs/harmonyos-agent-skills-LICENSE.txt`；本地文件 SHA-256 为 `4c99401b4c5bf4f8de4cf16eef3191852ba607d67d27609cdd91b3aee3f62ed3`。只新增了上述 Skill 目录和许可证文件。

### CLI 1.3.0 构建错误判定

- 本机安装包的构建调用路径为 `build -> ob -> _c -> qe.buildModules -> qe.runHvigor`，实现位于 打包后的 CLI（`@deveco/deveco-cli/dist/cli.js`，位于本机 npm 全局安装目录）。`qe.runHvigor` 通过 `execa` 启动 Hvigor；Hvigor 非零退出会 reject，`_c` 将其包装为 `hvigor build` 错误，外层命令处理器设置 `process.exitCode = 1`。检查到的构建路径校验产品/构建模式及模块，没有 CLI 侧的签名成功后置校验。
- 所给构建日志记录：签名配置缺失时跳过签名，生成 `entry-default-unsigned.hap`，随后有 `BUILD SUCCESSFUL`；Hvigor 关闭阶段又报告 `hvigor_failed` / `Server has disconnected`，最终 worker 退出码为 1。CLI 将 Hvigor 的非零退出码传递出来，与日志相符。
- **不能据此认定缺少签名导致退出码 1。** 日志先明确显示构建成功，失败发生在 Hvigor 关闭/会话断开阶段；现有证据未说明断开的根因，也未证明两者存在因果关系。`runHvigor` 默认继承 stdio，因此 CLI 源码不会把子进程 stderr 收集为单独的诊断字段；当前证据不能恢复一份独立 stderr。

## 未能确认

- 这台 Mac 上 DevEco Studio / Emulator 的确切版本、窗口标识、ScreenCaptureKit 权限状态和前后台行为；本任务没有启动模拟器或请求权限。
- 鼠标到模拟器设备坐标的最终映射比例及各旋转/窗口尺寸下的校准结果；需要真实帧与 HDC 截图一起实测。
- 华为是否存在未公开、需授权的 DevEco Testing/Studio 视频流接口；公开页面只确认产品 UI 能力，没有找到可集成 SDK/API。
- HOScrcpy 上游占位版权人问题是否已修复；不能仅凭下游插件声明判断 JAR/设备端二进制的再分发权限。
- Apple TCC 权限在最终交付形态（原生 `.app`、签名 helper 或由 Codex/Terminal 启动的 Node 子进程）下具体归属哪个进程；应在最终运行形态实测。

## 文本输入追加核验（2026-10-10）

本机 CLI 1.3.0 的 `ui text` 对 `hello` 正常；对 `Codex Harmony` 报告成功但设备字段只追加 `Codex`，复杂组合字符串返回参数数量错误。已由真实 UI 树确认，不能仅以 CLI 的成功信息作为回显验收。

已安装源码的 `iR` 生成带双引号的 Base64 命令替换。OpenHarmony 当前 HDC 上游源码的 host 参数解析会移除双引号并以空格重组，这与本机字段拆分现象一致；本机 Huawei HDC 二进制与该上游提交的精确对应关系未单独确认。[HDC host 重组](https://github.com/openharmony/developtools_hdc/blob/master/src/host/host_shell_option.cpp) · [参数拆分](https://github.com/openharmony/developtools_hdc/blob/master/src/common/base.cpp)

插件保持 CLI 原样，先用官方 `ui click --id` 聚焦，再将固定 `uitest uiInput text` 与 POSIX 单引号引用后的文字整段编码，通过 HDC 的固定 `printf %s BASE64 | base64 -d | sh` 传到设备。host 传输中没有原始文字或其双引号；设备 shell 才解析一次文字字面值。此路径的中文、空格、单双引号和 shell 字符已在 fixture 实际回显验证。焦点命令从 API 18 起支持；当前 API 26 已核实。[官方 UITest text/inputText](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/application-test/uitest-guidelines.md#注入ui模拟操作) · [官方 HDC shell](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/dfx/hdc.md)
