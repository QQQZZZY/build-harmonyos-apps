# Build HarmonyOS Apps

macOS 本地 Codex 插件与独立 `serve-hos`。复用已安装的 Huawei DevEco CLI、HDC、官方 DevEco CLI Skill 和 ArkUI Skill，提供构建、部署、日志、设备 UI 操作和浏览器预览。

这是本地开发工具，源码托管于 [GitHub](https://github.com/QQQZZZY/build-harmonyos-apps)，尚未发布 npm 包或上传公共插件目录。源码可独立运行，DevEco CLI 保持原样。

## 安装与启动

窗口捕获要求 macOS 14+ 与 Xcode Command Line Tools；设备工作流要求 Node.js 22+、已安装的 DevEco CLI 和配套 HarmonyOS SDK。原生 helper 不可用时 MCP 仍提供 HDC 操作和截图降级。焦点文本输入要求设备 API 18+；本机验收使用 API 26。首次安装 Node 依赖需要联网。

```sh
git clone https://github.com/QQQZZZY/build-harmonyos-apps.git
cd build-harmonyos-apps/build-harmonyos-apps
npm ci --ignore-scripts
npm run build
npm run doctor
node src/cli.mjs devices
node src/cli.mjs windows
node src/cli.mjs --device SERIAL
```

打开打印出的完整 `http://127.0.0.1:3200/#...` 地址。令牌仅用于这一进程，重启后变化。默认 `auto` 按所选设备的名称和窗口 PID 匹配可见模拟器窗口；无法唯一匹配时可显式选择 `--window-id`。CLI 独立于 Codex 使用。

```sh
# 指定窗口 / 强制使用 HDC 降级
node src/cli.mjs --device SERIAL --source sck --window-id WINDOW_ID
node src/cli.mjs --device SERIAL --source hdc --interval-ms 1000

# 可选：注册本机 serve-hos 命令
npm link --ignore-scripts
serve-hos --device SERIAL
```

ScreenCaptureKit 需要已有录屏权限。`doctor`、`windows` 和默认启动只读检查权限；缺少权限时 `auto` 使用 HDC。用户需要授权时可运行 `node src/cli.mjs permission`，在 macOS 系统设置中完成授权，再按系统要求重启宿主和捕获进程。预览不会捕获音频、麦克风或整个桌面。

ScreenCaptureKit 的窗口图包含外壳和工具栏。先在浏览器中拖选实际触摸屏区域，对照当前 HDC 截图确认方向和内容，再轻触一个已知无损控件并检查状态变化。窗口或设备尺寸变化会降级 HDC；恢复后使用网页“重试采集”或 `hos_preview_retry` 重新选择 SCK 并校准，URL 和令牌保持不变。捕获区域或缩放 metadata 变化会清除校准。HDC 截图直接使用设备坐标，可立即操作。

模拟器 serial 以连接设备的唯一名称匹配为准，避免 CLI 1.3.0 列表按顺序猜测造成双设备编号错配；不确定的匹配不会绑定窗口或显示场景控制。窗口绑定会检查窗口所属进程 PID 和 CLI 实际启动参数对应的模拟器名称，再关联设备 serial。无法确认对应关系时 `auto` 使用 HDC，显式 `sck` 启动返回错误；本版核验的启动形式是 `Emulator -start NAME -bootmode snapshot`，其他工具版本或手工启动形式需后续验证。

## Codex 插件

```sh
codex plugin marketplace add /absolute/path/to/build-harmonyos-apps
codex plugin add build-harmonyos-apps@harmonyos-local
codex plugin list --marketplace harmonyos-local --json
```

当前包同时提供根目录 `plugin.json` / `mcp.json` 和 Codex 兼容清单 `.codex-plugin/plugin.json` / `.mcp.json`。安装后重新载入插件或开启新聊天，使宿主重新发现工具。本地安装和 SDK 握手已实测；当前聊天不会自动获得新工具。

插件包含两个 stdio MCP；设备服务共 29 个工具：

| 服务 | 用途 |
| --- | --- |
| `harmonyos` | `hos_*` 工具：自检、设备/模拟器、构建、运行、安装、启动、日志、截图、UI 树、轻触/双击/长按/滑动/拖拽、输入、Back/Home、场景控制、事件、预览切换/重试与校准 |
| `deveco-code` | 原样调用 `devecocli serve mcp`，提供官方 `check` 与 LSP 工具 |

`harmonyos` 的构建/运行工具接受显式绝对项目路径。官方 `deveco-code` 以 `PROJECT_PATH` 或宿主工作目录为项目根；使用官方语法工具前需在目标 HarmonyOS 项目启动，或按 CLI 的说明配置 `PROJECT_PATH`。这项项目根限制属于官方 MCP，设备工作流不依赖它。

如只接入 MCP，可使用：

```sh
codex mcp add harmonyos -- node /absolute/path/to/build-harmonyos-apps/build-harmonyos-apps/scripts/start-mcp.mjs
```

选择插件或单独 MCP 中一种，避免重复工具。MCP 启动脚本仅在缺少依赖/原生 helper 时安装锁定的 Node 依赖并编译；诊断走 stderr，stdout 保留给 MCP。标准输出已用官方 SDK 握手验证。

## ZCode 插件

本仓库同时提供 ZCode 插件适配：ZCode 清单在 [`.zcode-plugin/plugin.json`](.zcode-plugin/plugin.json)（两个 MCP 服务内联声明，`harmonyos` 通过 `${CLAUDE_PLUGIN_ROOT}` 定位 `scripts/start-mcp.mjs`），本地市场目录为仓库根级 [`../marketplace.json`](../marketplace.json)（市场名 `build-harmonyos-apps`）。Skills 与 MCP 服务由 Codex / ZCode 两端共享，功能一致。

在 ZCode Desktop 中安装：

1. 打开 **插件市场 → 添加 → 添加插件市场**，粘贴本仓库根目录的绝对路径（即 `marketplace.json` 所在目录）。
2. 在该市场中选择 **Build HarmonyOS Apps** 并安装。
3. 新建任务试用：例如「使用 Build HarmonyOS Apps 构建、运行并验证当前鸿蒙项目」。

运行依赖与 Codex 侧相同：Node.js 22+、已安装的 DevEco CLI 和配套 HarmonyOS SDK；窗口捕获另需 macOS 14+ 与 Xcode Command Line Tools。首次启动 `harmonyos` MCP 时若缺少 Node 依赖会自动联网 `npm ci`。`deveco-code` 服务需要 PATH 上有 `devecocli`，缺失只影响该服务，`harmonyos` 的 `hos_*` 工具不受影响。

## 浏览器工作台（0.2.1）

- 界面：深色桌面布局、设备轮廓与选中状态、带名称的图标工具栏；应用和诊断入口默认收起，定位/传感器位于场景次级分组。连接中的本地模拟器只在本地列表出现一次。
- 左栏：搜索已连接设备与本地模拟器，启动/停止已有模拟器，切换活动设备。没有连接设备时也可打开工作台；每个服务同时只预览一个活动设备。
- 中央：正常显示裁剪后的触摸屏；校准时显示完整窗口。提供 Home/Back、真实设备 PNG 截图、适应窗口/缩放、采集来源重试。支持轻触、双击/长按模式、按住长按、滑动/拖拽模式和滚轮映射滑动；文本框支持中文组合输入与粘贴，点击发送后输入设备。
- 右栏：UI 树搜索、节点属性、设备像素 bounds 高亮和按 id 操作；有界日志按 Bundle、关键词、等级与崩溃类型过滤；操作记录显示结果与耗时。命令成功仍需通过画面/UI 树核验实际状态。
- 应用：选择或拖入一个 `.hap` 安装包，浏览器入口最大 128 MiB；可手填 Bundle/Ability 启动。显示的是本进程记录的最近安装/启动信息，**不是当前前台应用**；HAP 缺少可识别的 module.json 时需手填；损坏或非法元数据会拒绝安装。没有删除或卸载入口。
- 模拟器场景：旋转、电量/充电状态、经纬度、步数、音量与息屏/唤醒。网页仅向 `deviceType=foldable` 提供展开/半展开/合拢，其他折叠型号的状态映射尚未验证。MCP `hos_emulator_control` 另提供官方 CLI 的其他传感器和场景参数，每次只传一个设置项。

切换设备、重试采集和场景改变会更新 `session`。网页清空旧帧、控件、文本与日志，收到同会话的新帧后恢复画面输入；安装/启动和电源控制不依赖新鲜画面。MCP 在操作预览坐标时使用 `hos_preview_status` 返回的 `session`，旧会话请求会被拒绝。`hos_preview_select` / `hos_preview_retry` 保留现有服务地址。

`hos_run` 支持 `apply:true` 或 `hotReloadApply:true`，二者互斥，并必须提供 `changeFile`：目标项目 `.hvigor/` 下已存在的变更清单文件名。不能同时使用 `skipBuild`。`apply` 增量编译/部署并重启；`hotReloadApply` 只向已经运行的官方热重载 watch 会话应用变更，不会自行启动后台会话。真实热重载效果须在目标项目另行验收。

## 环境覆盖

- `DEVECO_CLI_BIN`：自定义 `devecocli` 可执行路径。
- `HDC_BIN`：HDC 绝对路径。默认检查 DevEco CLI 的 Studio 环境变量、`/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc` 和 PATH。
- 自定义 Studio/CLT、签名、SDK 和文档配置继续遵循官方 CLI；插件不读取或输出登录凭据。

CLI 子命令可用 `--help` 查看已实现参数。停止服务用 Ctrl+C 或 MCP `hos_preview_stop`；关闭浏览器不停止服务。一个 MCP 进程管理一个预览，多个进程可用不同端口和显式设备并行运行。

DevEco CLI 1.3.0 的文本封装在本机实测会截断带空格的输入。插件的文本入口先用官方 CLI 按节点聚焦，再用 HDC 传输 Base64 编码的、正确引用的 `uitest uiInput text` 脚本；用户文字仅作为字面参数，空间、中文和引号均按完整回显验收。首次启用系统输入法可能弹出协议/权限设置，由使用者自行完成后再测试。

## 验证与边界

以下命令在本插件目录内执行：

```sh
npm test
node native/check.mjs WINDOW_ID
node scripts/create-fixture.mjs --path /absolute/empty/ServeHosFixture
node scripts/e2e.mjs --project /absolute/ServeHosFixture --device SERIAL --source hdc
```

实际验收、证据及未验证项以 [docs/validation.md](docs/validation.md) 为准。架构与验收标准见 [docs/architecture.md](docs/architecture.md)，官方能力/复用核验见 [docs/research.md](docs/research.md)。

本版采用本地 JPEG 帧传输，默认目标 10 fps（可配置 1–30 fps）；静态窗口保持最后完整帧，独立窗口状态心跳判断健康。最小化、关闭、完全移出屏幕、捕获失效，以及操作后窗口无新帧时降级 HDC。恢复窗口后通过网页或 `hos_preview_retry` 明确重试 SCK，并重新校准。后台模拟器可能停止重绘，不能仅凭窗口存在认为画面代表最新设备状态。

浏览器使用 ETag 条件取帧；同会话同帧返回 304，来源/会话切换未取得有效帧时返回不可用。截图轮询不会重叠，实际帧率受 DevEco CLI/HDC 截图耗时影响。工具针对默认设备显示屏；本版未提供远程公网访问、视频音频编码、设备端 HOScrcpy 和多显示屏交互。真实设备只适用 HDC 预览路径。macOS 14 与 Intel 运行情况尚需验证。

## 官方内容与许可证

- `skills/deveco-cli`：从本机官方 `@deveco/deveco-cli` 1.3.0 原样复用，MIT 许可证见 `docs/deveco-cli-LICENSE.txt`。
- `skills/hmos-arkui-develop-skill`：通过官方 CLI 安装的 1.1.1 包，38 个文件原样复用；MIT 许可证见 `docs/harmonyos-agent-skills-LICENSE.txt`。包 SHA-256：`b11b85a8aecfb4c0743b254de9bd98183cd218f6cf988731ffa5d46393fa15e1`。
- 官方其他能力按需用 `devecocli skills find` / `skills add` 安装，保持上游维护。
- 自有实现使用 MIT；Node 依赖的许可随 npm 包保留。未打包 Huawei SDK、DevEco CLI、设备系统镜像或 HOScrcpy JAR。

本插件由用户本地开发，名称、图标和工具并不表示 Huawei 或 OpenAI 官方背书。[Huawei DevEco CLI](https://developer.huawei.com/consumer/cn/deveco-studio) · [OpenAI 插件规范](https://developers.openai.com/plugins/build/plugins) · [Apple ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit)

## 开源与隐私

源码与发布包的隐私检查及运行数据边界见 [docs/privacy.md](docs/privacy.md)。公开源码包排除本地运行记录、截图、日志、原生二进制、依赖目录及 macOS 文件元数据。`doctor`、截图、UI 树和 E2E 结果可能包含使用者的路径、设备信息和应用内容；分享前需另行检查。
