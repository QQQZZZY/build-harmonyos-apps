# Build HarmonyOS Apps

macOS 本地 Codex 插件与独立 `serve-hos`。复用已安装的 Huawei DevEco CLI、HDC、官方 DevEco CLI Skill 和 ArkUI Skill，提供构建、部署、日志、设备 UI 操作和浏览器预览。

这是本地开发工具，源码托管于 [GitHub](https://github.com/QQQZZZY/build-harmonyos-apps)，尚未发布 npm 包或上传公共插件目录。源码可独立运行，DevEco CLI 保持原样。

## 安装与启动

窗口捕获要求 macOS 14+ 与 Xcode Command Line Tools；设备工作流要求 Node.js 22+、已安装的 DevEco CLI 和配套 HarmonyOS SDK。原生 helper 不可用时 MCP 仍提供 HDC 操作和截图降级。焦点文本输入要求设备 API 18+；本机验收使用 API 26。首次安装 Node 依赖需要联网。

```sh
git clone https://github.com/QQQZZZY/build-harmonyos-apps.git
cd build-harmonyos-apps
npm ci --ignore-scripts
npm run build
npm run doctor
node src/cli.mjs devices
node src/cli.mjs windows
node src/cli.mjs --device SERIAL
```

打开打印出的完整 `http://127.0.0.1:3200/#...` 地址。令牌仅用于这一进程，重启后变化。默认 `auto` 优先捕获唯一可见模拟器窗口；多窗口时显式选择 `--window-id`。CLI 独立于 Codex 使用。

```sh
# 指定窗口 / 强制使用 HDC 降级
node src/cli.mjs --device SERIAL --source sck --window-id WINDOW_ID
node src/cli.mjs --device SERIAL --source hdc --interval-ms 1000

# 可选：注册本机 serve-hos 命令
npm link --ignore-scripts
serve-hos --device SERIAL
```

ScreenCaptureKit 需要已有录屏权限。`doctor`、`windows` 和默认启动只读检查权限；缺少权限时 `auto` 使用 HDC。用户需要授权时可运行 `node src/cli.mjs permission`，在 macOS 系统设置中完成授权，再按系统要求重启宿主和捕获进程。预览不会捕获音频、麦克风或整个桌面。

ScreenCaptureKit 的窗口图包含外壳和工具栏。先在浏览器中拖选实际触摸屏区域，对照当前 HDC 截图确认方向和内容，再轻触一个已知无损控件并检查状态变化。窗口或设备尺寸变化会降级 HDC；重新启用 SCK 需停止/启动并校准。捕获区域或缩放 metadata 变化会清除校准。HDC 截图直接使用设备坐标，可立即操作。

窗口绑定会检查窗口所属进程 PID 和 CLI 实际启动参数对应的模拟器名称，再关联设备 serial。无法确认对应关系时 `auto` 使用 HDC，显式 `sck` 启动返回错误；本版核验的启动形式是 `Emulator -start NAME -bootmode snapshot`，其他工具版本或手工启动形式需后续验证。

## Codex 插件

```sh
codex plugin marketplace add /absolute/path/to/build-harmonyos-apps
codex plugin add build-harmonyos-apps@harmonyos-local
codex plugin list --marketplace harmonyos-local --json
```

当前包同时提供根目录 `plugin.json` / `mcp.json` 和 Codex 兼容清单 `.codex-plugin/plugin.json` / `.mcp.json`。安装后重新载入插件或开启新聊天，使宿主重新发现工具。本地安装和 SDK 握手已实测；当前聊天不会自动获得新工具。

插件包含两个 stdio MCP；设备服务共 21 个工具：

| 服务 | 用途 |
| --- | --- |
| `harmonyos` | `hos_*` 工具：自检、设备/模拟器、构建、运行、安装、启动、日志、截图、UI 树、点击、滑动、输入、Back/Home、预览与校准 |
| `deveco-code` | 原样调用 `devecocli serve mcp`，提供官方 `check` 与 LSP 工具 |

`harmonyos` 的构建/运行工具接受显式绝对项目路径。官方 `deveco-code` 以 `PROJECT_PATH` 或宿主工作目录为项目根；使用官方语法工具前需在目标 HarmonyOS 项目启动，或按 CLI 的说明配置 `PROJECT_PATH`。这项项目根限制属于官方 MCP，设备工作流不依赖它。

如只接入 MCP，可使用：

```sh
codex mcp add harmonyos -- node /absolute/path/to/build-harmonyos-apps/scripts/start-mcp.mjs
```

选择插件或单独 MCP 中一种，避免重复工具。MCP 启动脚本仅在缺少依赖/原生 helper 时安装锁定的 Node 依赖并编译；诊断走 stderr，stdout 保留给 MCP。标准输出已用官方 SDK 握手验证。

## 环境覆盖

- `DEVECO_CLI_BIN`：自定义 `devecocli` 可执行路径。
- `HDC_BIN`：HDC 绝对路径。默认检查 DevEco CLI 的 Studio 环境变量、`/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc` 和 PATH。
- 自定义 Studio/CLT、签名、SDK 和文档配置继续遵循官方 CLI；插件不读取或输出登录凭据。

CLI 子命令可用 `--help` 查看已实现参数。停止服务用 Ctrl+C 或 MCP `hos_preview_stop`；关闭浏览器不停止服务。一个 MCP 进程管理一个预览，多个进程可用不同端口和显式设备并行运行。

DevEco CLI 1.3.0 的文本封装在本机实测会截断带空格的输入。插件的文本入口先用官方 CLI 按节点聚焦，再用 HDC 传输 Base64 编码的、正确引用的 `uitest uiInput text` 脚本；用户文字仅作为字面参数，空间、中文和引号均按完整回显验收。首次启用系统输入法可能弹出协议/权限设置，由使用者自行完成后再测试。

## 验证与边界

```sh
npm test
node native/check.mjs WINDOW_ID
node scripts/create-fixture.mjs --path /absolute/empty/ServeHosFixture
node scripts/e2e.mjs --project /absolute/ServeHosFixture --device SERIAL --source hdc
```

实际验收、证据及未验证项以 [docs/validation.md](docs/validation.md) 为准。架构与验收标准见 [docs/architecture.md](docs/architecture.md)，官方能力/复用核验见 [docs/research.md](docs/research.md)。

本版采用本地 JPEG 帧传输，默认上限 10 fps；静态窗口保持最后完整帧，独立窗口状态心跳判断健康。最小化、关闭、完全移出屏幕、捕获失效，以及操作后窗口无新帧时降级 HDC。恢复窗口后需要停止/重启预览重试 SCK。后台模拟器可能停止重绘，不能仅凭窗口存在认为画面代表最新设备状态。

截图轮询不会重叠，实际帧率受 DevEco CLI/HDC 截图耗时影响。工具针对默认设备显示屏；本版未提供远程公网访问、视频音频编码、设备端 HOScrcpy 和多显示屏交互。真实设备只适用 HDC 预览路径。macOS 14 与 Intel 运行情况尚需验证。

## 官方内容与许可证

- `skills/deveco-cli`：从本机官方 `@deveco/deveco-cli` 1.3.0 原样复用，MIT 许可证见 `docs/deveco-cli-LICENSE.txt`。
- `skills/hmos-arkui-develop-skill`：通过官方 CLI 安装的 1.1.1 包，38 个文件原样复用；MIT 许可证见 `docs/harmonyos-agent-skills-LICENSE.txt`。包 SHA-256：`b11b85a8aecfb4c0743b254de9bd98183cd218f6cf988731ffa5d46393fa15e1`。
- 官方其他能力按需用 `devecocli skills find` / `skills add` 安装，保持上游维护。
- 自有实现使用 MIT；Node 依赖的许可随 npm 包保留。未打包 Huawei SDK、DevEco CLI、设备系统镜像或 HOScrcpy JAR。

本插件由用户本地开发，名称、图标和工具并不表示 Huawei 或 OpenAI 官方背书。[Huawei DevEco CLI](https://developer.huawei.com/consumer/cn/deveco-studio) · [OpenAI 插件规范](https://developers.openai.com/plugins/build/plugins) · [Apple ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit)

## 开源与隐私

源码与发布包的隐私检查及运行数据边界见 [docs/privacy.md](docs/privacy.md)。公开源码包排除本地运行记录、截图、日志、原生二进制、依赖目录及 macOS 文件元数据。`doctor`、截图、UI 树和 E2E 结果可能包含使用者的路径、设备信息和应用内容；分享前需另行检查。
