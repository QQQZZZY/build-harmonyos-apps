# 本机验证与可复现工作流

验证日期：2026-10-09 至 2026-10-10（Asia/Shanghai）。本次通过真实模拟器、官方 SDK/CLI、实际浏览器和 stdio MCP 完成验证。

## 环境

| 项目 | 实际环境 |
| --- | --- |
| Mac | Apple Silicon / arm64，macOS 15.7.9 |
| Node | 24.21.0；运行要求 22+ |
| Swift | 6.2.4；编译部署目标 macOS 14 |
| DevEco Studio | 26.0.0 |
| DevEco CLI | 1.3.0，保持原安装；未升级或 Fork |
| HDC | SDK 内的 3.2.0f，原先未在 PATH |
| 模拟器 | Pura X Max，widefold，HarmonyOS 7.0.0 / API 26 |
| 设备 serial | 本次使用回环地址连接的模拟器；公开记录省略实例标识 |
| 录屏权限 | 本机预先已授予；只读取状态，未代替使用者授权 |
| MCP SDK | 锁定 1.32.1；当前依赖审计为零已知漏洞 |

## 已验证结果

| 检查 | 证据与结果 |
| --- | --- |
| 环境自检 | 找到 CLI、SDK HDC、模拟器、现有录屏权限；可用 `doctor` 输出同样字段 |
| 官方 Skills | CLI Skill 1.3.0 原样复用；官方 ArkUI Skill 1.1.1 通过 CLI 下载、校验并原样保存 38 文件和 MIT 许可证 |
| 官方 MCP | stdio 握手、10 个代码/LSP 工具发现；设置真实 `PROJECT_PATH` 后 `check` 对 fixture Index.ets 返回 `no diagnostics` |
| 原生窗口捕获 | 所选窗口的 PID 匹配 Pura X Max 的启动参数；真实 2086×1362 JPEG、窗口状态心跳、元数据、SIGTERM 正常退出 |
| 构建/部署/启动 | fixture 的 `hos_build`、`hos_run --skip-build` 实际通过，产生并安装 unsigned HAP（模拟器允许） |
| 独立安装/启动命令 | `hos_install` 与 `hos_launch` 已分别在 fixture 实际执行并返回安装、启动成功。未安装 HAP 的 `aa start` 返回 error 文本即使进程为 0，适配层按失败处理 |
| UI 树/点击/滑动 | 真实节点 id 点击使计数变化；滑动改变可见 Row 集合；只读 visible UI 树对照状态 |
| 文本 | 中文、空格、双引号、单引号、`<&$>`、前导 `-` 完整回显；使用者自行完成了系统输入法首次协议设置 |
| 真实 Hilog | 返回 fixture 的 Ability 生命周期与 `serve-hos fixture ready` 应用日志 |
| HDC E2E | 9 个实际阶段通过：构建、部署/启动、节点点击、浏览器帧、映射点击、滑动、文本回显、截图/树/日志、停止与端口回收 |
| SCK E2E | 窗口捕获与校准成功、映射点击成功；后台操作后没有新窗口帧，自动降级 HDC，后续 9 个阶段全部通过 |
| 实际浏览器 | 拖选屏幕校准；点击计数 0→1；最终 HDC 模式点击 2→3，文本包含 `Browser 验收 O'Reilly "<&$>"`，拖动后 Row 7–10→Row 3–6 |
| 访问边界/清理 | 随机令牌、Origin/Host、未知动作拒绝；停止释放监听端口、临时文件与本进程 helper |
| 自动检查 | `npm test` 的 8 项针对性检查通过：坐标边界、CLI JSON/PNG、参数拒绝、HTTP 边界、shell 字面值/取消、并发生命周期、设备画面与窗口帧进度、MCP 工具/图片/清理 |
| 插件解析 | Codex CLI 已发现并安装本地插件，两个 MCP 均启用；`${PLUGIN_ROOT}` 被解析为真实缓存目录，入口存在 |
| 可移植首次启动 | 从不带 node_modules/native binary 的归档解包，自动安装锁定依赖并完成 MCP 握手，实际发现 21 个设备工具；模拟 Swift 不可用后真实 HDC PNG、停止和端口回收通过 |
| 编译后启动 | 解包目录原生 helper 编译成功；MCP doctor 返回已有录屏许可 true，窗口发现只返回 Emulator 窗口 |

上述 SCK 结果证明前台窗口帧、校准和后台降级可用，**没有证明后台持续实时视频**。本机窗口在后台会滞留旧画面；服务以设备截图变化和窗口帧进度判断并降级。静态窗口有独立状态心跳，不以最后一张 JPEG 的时间单独判断失效。

首次 fixture 构建曾在 `BUILD SUCCESSFUL` 后发生 Hvigor `Server has disconnected`，最终退出为 1。适配层保持失败语义；随后真实 build/run 与两次 E2E 均通过。未修改 CLI、Hvigor 或签名配置来隐藏该错误。

官方 MCP 冷启动第一次 `check` 返回 `Project is syncing`；保持同一服务会话等待其提示的 10 秒后重试一次，得到无诊断。这是官方工程同步阶段；调用者应根据实际响应等待同步完成。

## 复现

先完成 README 的依赖安装、原生编译和 `doctor`。使用一个新的空路径创建专用验收工程；生成器不会覆盖既有工程。

```sh
node scripts/create-fixture.mjs --path /absolute/empty/ServeHosFixture
devecocli emulator list --format json
devecocli emulator start "Existing Emulator Name"
node src/cli.mjs devices

node scripts/e2e.mjs \
  --project /absolute/ServeHosFixture \
  --device SERIAL \
  --source hdc \
  --output /absolute/results-hdc
```

E2E 只用于包含 `tests/fixture.ets` 页面结构的专用工程，会构建、安装并操作该 fixture。它不会卸载任何应用。初次打开输入框如果出现系统输入法的协议或权限界面，由使用者自行处理后再运行；脚本不会代替使用者接受协议。

SCK 校准值来自当前窗口，不可复用本机示例的窗口 ID、serial 或矩形：

```sh
node src/cli.mjs windows
node native/check.mjs WINDOW_ID
node src/cli.mjs --device SERIAL --source sck --window-id WINDOW_ID
```

打开返回 URL，在窗口画面中拖选触摸屏区域，确认它与最新 HDC 截图一致。取得归一化 `x,y,width,height` 后可验证：

```sh
node scripts/e2e.mjs \
  --project /absolute/ServeHosFixture \
  --device SERIAL --source sck --window-id WINDOW_ID \
  --crop x,y,width,height --output /absolute/results-sck
```

结果文件包含 `e2e.json`、`device.png`、`ui-tree.json`；失败时保留已完成阶段和错误。浏览器保存画面是当前预览源；MCP `hos_screenshot` 始终返回真实设备 PNG。

## 尚未本机验证

- macOS 14 实际运行、Intel 编译/运行；已有证据仅为 arm64 macOS 15.7.9。
- 真机、其他 HarmonyOS/SDK/DevEco CLI 版本与非 `snapshot` 模拟器启动形式。
- 首次录屏授权、拒绝权限和授权后宿主重启的完整系统 UI；本机已有许可。
- 最小化/完全离屏/关闭窗口的完整实际操作；实现和 Apple 行为依据已记录，实际停帧降级已在后台验证。
- 窗口拖动缩放、设备旋转/折叠和副显示屏的真实坐标验收；当前实现遇到尺寸变化降级，并要求重启 SCK 后重新校准。
- 持续动态视频的帧率、延迟、CPU/内存基准；10 fps 为配置上限。
- 真机签名、Huawei 登录、云端证书生成与生产项目发布。

## 使用结束

`hos_preview_stop` 或独立 CLI 的 Ctrl+C 停止本进程服务。其他 Codex 聊天的预览和共享 Hvigor daemon 不属于此会话的清理范围。验收应用可保留供复测；本次初始停止的模拟器将在收尾恢复为停止状态。实际后台状态以交付时的进程/端口检查为准。
