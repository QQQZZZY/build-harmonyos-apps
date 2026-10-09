# serve-sim 对比：Build HarmonyOS Apps 功能补充建议

核验日期：2026-10-10。鸿蒙基线为 `v0.1.2` / `46acba0`；serve-sim 上游固定到 `c60d583`。本报告结合提供的截图、两边源码、本机 CLI 帮助和华为官方资料；第 1–5 节保留迭代前的差距分析；0.2.0 实施进度以第 6 节为准。

## 1. 迭代前结论（0.1.2 基线）

当前插件已覆盖自检、构建、安装、启动、日志、设备截图、可见 UI 树、点击/滑动/文本及浏览器预览，并提供 21 个设备 MCP 工具和独立的官方代码诊断 MCP。补充工作的重点是把这些能力组织成可供人和浏览器代理使用的设备工作台。

建议先完成设备选择、快捷操作、UI 检查器和诊断面板，同时降低手工校准与恢复预览的成本。折叠、旋转、GPS、电池和传感器有 CLI 复用入口；摄像头、网络与系统外观设置需要分别核验接口和版本。

基线来源：[当前工具定义](https://github.com/QQQZZZY/build-harmonyos-apps/blob/46acba0b41952c4067e88cccc87ab5683db5f935/src/tools.mjs)、[当前网页](https://github.com/QQQZZZY/build-harmonyos-apps/blob/46acba0b41952c4067e88cccc87ab5683db5f935/web/index.html)、[网页交互](https://github.com/QQQZZZY/build-harmonyos-apps/blob/46acba0b41952c4067e88cccc87ab5683db5f935/web/app.js)、[采集与会话逻辑](https://github.com/QQQZZZY/build-harmonyos-apps/blob/46acba0b41952c4067e88cccc87ab5683db5f935/src/preview.mjs)。

## 2. 截图中的设计可借鉴什么（0.1.2 基线）

- **左侧设备栏：** 搜索、设备名称/型号/系统、运行与预览状态、选择设备。鸿蒙当前只有 CLI/MCP 设备列表和启动，网页没有设备目录与切换入口；设备停止也没有 MCP 包装。
- **中央设备视图：** 让实际触摸屏成为主要画面，保留清晰的设备/采集状态和精简工具栏。当前 SCK 仍显示捕获的整个模拟器窗口，校准矩形只用于坐标映射，没有把显示内容裁成触摸屏。
- **右侧工具栏：** 以可收起区域呈现应用信息、操作事件、日志、控件树和设备场景。当前网页有原始 JSON UI 树，没有节点与画面的联动。

serve-sim 上游已有对应的[设备栏](https://github.com/EvanBacon/serve-sim/blob/c60d583747b88a15616eeecec56f287ef5759769/packages/serve-sim/src/client/components/grid-panel.tsx)、[工具面板](https://github.com/EvanBacon/serve-sim/blob/c60d583747b88a15616eeecec56f287ef5759769/packages/serve-sim/src/client/components/tools-panel.tsx)、[AX 树](https://github.com/EvanBacon/serve-sim/blob/c60d583747b88a15616eeecec56f287ef5759769/packages/serve-sim/src/client/components/ax-tree-tool.tsx)和[画面节点覆盖层](https://github.com/EvanBacon/serve-sim/blob/c60d583747b88a15616eeecec56f287ef5759769/packages/serve-sim/src/client/components/ax-dom-overlay.tsx)。建议沿用这三块的信息组织方式，鸿蒙控制项按自身能力设置。

## 3. 功能差距与优先级（0.1.2 基线）

P0 是首批浏览器工作流；P1 是有明确需求或复用入口的第二批；P2 是接口或场景需要进一步核验的工作。成本仅是依据当前实现的相对判断，没有排期承诺。

| 能力 | serve-sim 参考 | 鸿蒙当前状态 | 建议补充 | 优先级 / 成本 |
| --- | --- | --- | --- | --- |
| 设备目录与切换 | 搜索目录、选择不同设备、启动/停止与状态 | MCP 可列设备/模拟器并启动；一个进程只管理一个预览；网页不能切换 | 左侧列表，显式选择、启动/停止；首版串行切换一个活动设备 | P0 / 中 |
| 中央视图与截图 | 集中的设备视图、截图、旋转工具栏 | SCK 整窗显示；网页保存当前窗口 JPEG 或设备 PNG；MCP 始终可取真实 PNG | 使用现有裁剪矩形显示触摸屏；增加 Home、截图、适配窗口/缩放；设备截图与窗口截图明确区分 | P0 / 低至中 |
| 输入交互 | 键盘/快捷键、滚轮、连续触控、多指 | 点击和松手后发送的一次滑动；文本框发送；网页只有 Back，MCP 另有 Home | 长按、双击、真实 drag 与滚轮转滑动；直接粘贴/中文组合输入；受支持的按键 | P0 / 中 |
| 控件检查器 | AX 节点列表和画面覆盖，高亮/选择联动 | 可取 UI 树、按 id 点击；网页只显示 JSON | 文字/id 搜索、节点属性、边框高亮、选择后操作、复制定位信息；为浏览器代理提供有语义的列表 DOM | P0 / 中 |
| 操作事件 | 有界事件历史与浏览器订阅 | 网页只有单条完成/错误提示；没有事件历史 | 保留操作时间、目标、结果、耗时与错误；区分命令成功和实际状态变化；默认不记录输入全文 | P0 / 低至中 |
| 应用日志/崩溃 | 浏览器可读取设备日志；操作事件另有面板 | MCP 可取限量 Hilog/crash；网页没有日志入口 | 先复用有界读取做应用过滤/搜索/刷新；需要实时查看时再用官方 follow，随设备切换和会话关闭清理 | P0，流式为 P1 / 中 |
| 预览恢复与效率 | 流传输、重连、编码回退 | 默认 SCK 10 fps；HDC 默认 1 秒轮询；网页每 100 ms 请求完整图像；SCK 失败后需停止/重启 | 只传输新帧或按需取帧、连接/帧率/延迟状态、显式重试 SCK、减少重复校准；保持 HDC 回退和旧帧禁用输入 | P0 恢复、P1 性能 / 中至高 |
| 旋转与折叠 | 旋转、受支持设备姿态控制 | 未包装为浏览器/MCP 动作；现有尺寸变化会降级并清除校准 | 复用 CLI；按设备类型暴露已验证姿态；操作后重新确认分辨率、画面源和坐标 | P1 / 中 |
| 应用上下文 | 当前应用图标、bundle、版本、进程 | 已可安装 HAP、启动能力、构建运行；网页没有应用信息 | 先显示本次部署应用的 bundle/ability、运行状态与安装/启动结果；再核验系统前台应用读取、停止/重启及 HAP 拖入安装 | P1 / 中 |
| 调试迭代 | serve-sim 聚焦模拟器预览与控制 | CLI 有增量部署/热重载，插件没有对应会话管理 | 按工程版本接入增量部署或热重载，显示准备/错误/结束；先以官方 CLI 工作流提供，确有需要再加网页按钮 | P1 / 中 |
| GPS、电量、传感器 | 定位及相关模拟器场景 | 本机 CLI 已列出对应命令，插件未接入 | GPS、电池/充电、传感器值和已有运动场景；状态回读/失败呈现及恢复改动前配置 | P1 / 中 |
| 外观与无障碍 | 外观、字体、对比度、朗读等开关 | 尚无等效插件入口；鸿蒙系统设置的可调用接口未确认 | 从实际可控制的深浅色/字体场景开始核验，区分模拟器外壳主题和设备系统主题 | P1 研究 / 不确定 |
| 素材、相机、网络、多指 | 素材拖入、摄像头注入、定位、多指 | 没有这些浏览器工具；官方 GUI 有部分能力，CLI 未证明对应入口 | 分别核验媒体导入/图片相机流、断网/弱网、多指轨迹；保留能力不可用状态 | P2 / 高或不确定 |
| 安装与分发 | npm 一条命令运行，已打包 helper | 已有 MCP 首次装依赖/编译；源码运行与 npm link；尚未发布 npm/预编译发行件 | 面向外部使用者提供可复现的一键安装或 GitHub 发行件；原生包按系统/架构检测并保留 HDC 降级 | P1 / 中 |
| 多设备同时预览/远程协作 | 多流与代理/LAN/远程配置 | 不同进程可用不同端口，单页面单预览，本地回环访问 | 单页切换稳定后再评估同屏多设备；远程访问单独设计身份验证与控制权 | P2 / 高 |

serve-sim 证据：[交互实现](https://github.com/EvanBacon/serve-sim/blob/c60d583747b88a15616eeecec56f287ef5759769/packages/serve-sim/src/client/simulator/SimulatorView.tsx)、[事件面板](https://github.com/EvanBacon/serve-sim/blob/c60d583747b88a15616eeecec56f287ef5759769/packages/serve-sim/src/client/components/event-log-tool.tsx)、[事件存储](https://github.com/EvanBacon/serve-sim/blob/c60d583747b88a15616eeecec56f287ef5759769/packages/serve-sim/src/event-log.ts)、[应用信息](https://github.com/EvanBacon/serve-sim/blob/c60d583747b88a15616eeecec56f287ef5759769/packages/serve-sim/src/client/components/app-detection-tool.tsx)、[流设置](https://github.com/EvanBacon/serve-sim/blob/c60d583747b88a15616eeecec56f287ef5759769/packages/serve-sim/src/client/components/stream-settings-tool.tsx)、[媒体拖入](https://github.com/EvanBacon/serve-sim/blob/c60d583747b88a15616eeecec56f287ef5759769/packages/serve-sim/src/client/hooks/use-media-drop.ts)、[上游说明](https://github.com/EvanBacon/serve-sim/blob/c60d583747b88a15616eeecec56f287ef5759769/packages/serve-sim/README.md)。鸿蒙状态以第 1 节的源码链接为准。

### 关键平台差异

1. serve-sim 从 Apple 模拟器 framebuffer 获取画面，鸿蒙当前捕获主机窗口，并辅以设备截图。已记录的后台停帧来自模拟器停止重绘；WebSocket/H.264 只改善传输/编码，不能恢复生产端没有生成的画面。[鸿蒙现有验收](https://github.com/QQQZZZY/build-harmonyos-apps/blob/46acba0b41952c4067e88cccc87ab5683db5f935/docs/validation.md)
2. 当前网页的指针移动只积累起止点，松手时才调用一次 swipe，不是逐帧同步的触控流。长按、拖拽和多指需要真正对应的设备动作与时序，不能只增加按钮或前端动画。
3. 截图里的 Liquid Glass 属于 iOS，VoiceOver 在鸿蒙应对应自身的屏幕朗读测试。serve-sim 的部分设置还调用了模拟器内私有 Accessibility helper；平台等效能力需独立核验。[serve-sim 设置实现](https://github.com/EvanBacon/serve-sim/blob/c60d583747b88a15616eeecec56f287ef5759769/packages/serve-sim/src/ui-settings.ts)
4. 鸿蒙 UI 树表示可访问的可见节点，不能把树检查器展示成整个应用的完整组件树；多窗口与旋转后的 bounds 必须匹配当前截图。

## 4. 鸿蒙官方能力核验

### 核验范围

核验日期：2026-10-10。本节只记录鸿蒙侧的本机 DevEco CLI help、已安装 CLI 实现和华为官方资料；没有执行模拟器或设备操作。

本机 `devecocli --version` 为 `1.3.0`。本机 DevEco Studio 与 Emulator 组件版本没有核对，因此不能据 CLI 版本推定新 GUI 功能在此环境可用。

状态含义：**CLI 已确认**表示当前安装版 help 明确列出；**官方 GUI 能力**表示华为文档明确描述 DevEco 模拟器界面能力，但不代表 CLI 有对应命令；**待验证**表示官方资料或 CLI help 没有证明目标型号/功能组合可用。

### 当前安装版 CLI 能力

| 类别 | help 中确认的能力 | 边界 |
|---|---|---|
| 模拟器控制 | `rotate`、`power`、`volume`、`fold`、`battery`、`geolocation`、`sensor`、`scene` | `fold` 状态参数包含 `open`、`half-open`、`close`、`vertical-open`、`single`、`double`、`triple` 及三折形态组合；help 未将 `widefold` 或 Pura X Max 映射到某一折叠场景。电池、电量、定位和传感器取值范围由命令 help 给出。**命令存在不等于型号已验证。** |
| UI 检查与输入 | `screenshot`、`layout`、`window list`、`click`、`doubleclick`、`longclick`、`swipe`、`fling`、`drag`、`dircfling`、`text` | `layout` 可指定窗口或所有窗口；`window list --all` 可包含系统窗口。help 没有列出多指手势命令。 |
| 日志 | `log --crash`、`log --follow` | 命令参数已确认，未运行取日志。 |
| 运行与热更新 | `run --apply`、`run --hotreload`、`run --hotreload-apply` | help 将 `--apply` 描述为增量 quickfix 后重启，将 `--hotreload-apply` 描述为不重启热更新；没有给出所需 DevEco Studio 版本。 |

本机 `devecocli emulator` 的控制实现会检查 Emulator 版本，低于 **7.0** 时拒绝场景控制。`fold` 实现对状态值作全局白名单校验，然后把状态交给底层 Emulator；CLI 未按目标模拟器的 `deviceType` 预检兼容性。因此 `widefold` / Pura X Max 的折叠动作须在对应模拟器上验收后才能确认。

以上 CLI 能力来自本机 `devecocli --help` 及相关子命令 `--help`；折叠兼容性和 Emulator 版本门槛还核对了当前全局安装包 `@deveco/deveco-cli/dist/cli.js`。这些是本机环境证据，不是跨版本兼容承诺。

### 官方 DevEco 模拟器 GUI 能力

#### 屏幕、主题、字体与屏幕朗读

华为模拟器工具栏文档明确列出旋转、音量、截屏、主页/返回/最近任务、电池模拟、GPS、虚拟传感器、网络代理，以及折叠/展开/悬停；模拟器设置可调整“模拟器主题”、截屏路径和模拟器语言。[使用工具栏](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-v5/ide-emulator-toolbar-V5)

创建模拟器时可为受支持设备配置屏幕尺寸、分辨率和 DPI；官方文档标注屏幕配置从 DevEco Studio 6.0.0 Beta1 起支持，后续版本扩展到折叠屏、平板和 2-in-1。[创建模拟器](https://developer.huawei.com/consumer/cn/doc/doccenter-deveco-studio/ide-emulator-create) [自定义虚拟设备屏幕](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/ide-emulator-customize-screen-configuration)

“模拟器主题”在官方工具栏说明中没有进一步定义为应用运行时的浅色/深色外观切换。所查 CLI help 也没有字体大小、色彩滤镜、降低动态效果、对比度、透明度或屏幕朗读开关。HarmonyOS 官方开发文档确有屏幕朗读无障碍体验指南，但它说明的是应用如何适配朗读服务，不能据此认定模拟器提供对应的系统级测试开关。[提升屏幕朗读无障碍体验](https://developer.huawei.com/consumer/cn/doc/doccenter-capabilities/improve-screen-reader-experience)

**结论：** 官方确认可配置模拟器硬件屏幕规格，也有模拟器自身主题/语言设置；serve-sim 图中的系统显示与无障碍开关能否在鸿蒙模拟器中等效控制，尚未证实。

#### 手势

官方屏幕操作指南确认模拟器 GUI 支持单击、双击、长按、滑动、拖动、文字输入；在 macOS 上按 Command 可呼出双指捏合界面。该指南描述的是特定双指缩放交互，没有确认任意多指轨迹或可脚本化的多点触控。[操控屏幕](https://developer.huawei.com/consumer/cn/doc/HarmonyOS-Guides/ide-emulator-control-screen)

**结论：** 基础鼠标手势和双指捏合有官方 GUI 文档支持；本机 CLI 暴露的手势仍是单点操作，多指自动化能力未证实。

#### 摄像头、网络与媒体

DevEco Studio 26.0.0 官方发布说明称 Emulator 支持外接 USB 摄像头；没有可用摄像头时提供虚拟相机，用于模拟拍照流程。同一版本新增模拟器网络断连模拟。该发布版本配套的 Emulator 为 `26.0.0.400`。[DevEco Studio 26.0.0 新增和增强特性](https://developer.huawei.com/consumer/en/doc/harmonyos-releases/deveco-studio-new-features-2600)

上述是 Studio/Emulator 的官方能力，当前 `devecocli 1.3.0` 的 `emulator --help` 没有 camera 或 network 子命令。CLI 版本和 Emulator 版本不是同一版本号；本机 Emulator 组件未查，因此 26.0.0 新能力在本机是否可用待验证。工具栏文档另列“网络代理”面板，但未证明可配置延迟、带宽或丢包场景。

所查官方资料没有确认将任意图片/视频作为摄像头媒体流注入模拟器。Device File Browser 文档描述设备文件上传/下载，但要求 USB 连接，且明确应用沙箱视图不支持模拟器；不能据此证明模拟器相册导入或摄像头文件注入可用。[访问设备文件](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V14/ide-device-file-explorer-V14)

### 版本与未证实项

- **版本已知：** 本机 CLI 是 1.3.0；本机安装实现要求 Emulator 7.0 或更高版本才执行模拟器场景控制。命令 help 本身不显示该门槛。
- **官方版本边界：** DevEco Studio 26.0.0 发布说明确认外接/虚拟摄像头及网络断连模拟；官方资料没有说明较早 Emulator 版本是否具备这些能力。
- **本机未确认：** DevEco Studio、Emulator 组件版本；`widefold` / Pura X Max 的 `fold` 实际状态映射；系统级浅色/深色、字体缩放、色彩/动态效果/透明度/对比度、屏幕朗读开关；任意多指手势；摄像头文件流或媒体注入；网络延迟/带宽/丢包模拟。

### 可调用入口补充：Emulator 场景、UITest 与系统环境

- 本机 `devecocli emulator scene --help` 仅列出 `outdoorRunning`、`outdoorCycling`、`drivingNavigation`。已安装 CLI 的 `EmulatorManager.buildControlArgs` 将它们映射为 `-outdoorRunning`、`-outdoorCycling`、`-drivingNavigation`；其他映射包括 GPS、电池、传感器和折叠状态。该公开包装层没有 camera 或 network action。DevEco 26.0 Beta1 发布说明提到通过 Emulator commands 做场景模拟，26.0 Release 另列摄像头和网络断连能力，但没有把这两项映射到上述 scene 命令；按本机包装层与已读官方说明，GUI 功能的命令入口仍未证实。[DevEco Studio 26.0.0 新增和增强特性](https://developer.huawei.com/consumer/en/doc/harmonyos-releases/deveco-studio-new-features-2600)
- OpenHarmony 官方 UITest CLI 的 `uiInput` 命令列表包含 click、doubleClick、longClick、fling、swipe、drag、dircFling、text 和 keyEvent，没有 pinch；`uiRecord` 是录制交互到 CSV。官方指南另有测试 HAP 的“双指缩放”示例，属于 UITest API 示例，不是可直接调用的 shell 命令。指南没有提供原始触点帧流接口。[UI测试框架使用指导](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/application-test/uitest-guidelines.md)
- OpenHarmony 的 Wukong 稳定性测试 CLI 有随机 `-P/--pinch` 比例和 `-f/--finger` 1–4 指配置；它用于随机压力测试，没有给出指定双指坐标轨迹的动作接口。当前鸿蒙模拟器是否包含/允许调用 Wukong 未验证。[OpenHarmony ostest_wukong](https://github.com/openharmony/ostest_wukong)
- OpenHarmony Multimodal Input 仓库说明注入 API 当前只向系统应用开放，且现有示例仅注入 BACK 键；这不是第三方插件可用的通用触点注入入口。[OpenHarmony multimodalinput_input](https://github.com/openharmony/multimodalinput_input)
- HarmonyOS `Environment` 文档列出应用可读取的 `colorMode`、`fontScale` 和 `accessibilityEnabled` 环境值，并说明 Environment 属性不可变；这证明应用可读系统外观/字体/朗读状态，不能当成设置这些状态的公开写入 API。[Environment：设备环境查询](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-v5/arkts-environment-V5)


## 5. 建议实施顺序与验收

### 首批：浏览器设备工作台

范围：设备目录与串行切换、触摸屏主视图、Home/Back/设备截图、基础手势与粘贴、可搜索 UI 树及高亮、操作事件、应用 Hilog 面板。沿用现有服务、校准和 CLI 适配，不需要先替换前端框架。

验收：从页面选设备、启动预览、输入文字并回显、长按/拖拽改变控件状态、按 id 定位与高亮、查看对应应用日志；切换设备后画面/树/动作/日志均属于新设备，旧会话不遗留捕获进程。SCK 不可用时应可完成 HDC 操作。

### 第二批：鸿蒙适配与迭代

范围：先旋转，再对目标型号验收折叠；接入明确需求的 GPS、电池等场景、增量部署/热重载及外部安装体验。保留正常构建运行路径。

验收：旋转/折叠后暂停依赖旧坐标的输入，读取新尺寸，恢复画面后以控件状态证明映射正确；控制失败不能显示成已生效；热重载会话结束后完成其后台进程清理。

### 后续研究：图像链路与平台特殊场景

先测采集端、编码、传输、浏览器绘制各段时延，再决定帧推送与硬件视频编码的投入。摄像头/网络/多指需找到对应可调用接口并在专用工程中确认，再列入可用功能。

网页与 MCP 应共享同一动作实现和设备会话，新增能力保持两边一致。延续现有本地访问、随机令牌、参数校验和会话清理。

## 6. 0.2.0 实施进度

此节是功能迭代状态的统一入口；实际检查以 [validation.md](validation.md) 为准。第 1–5 节的“当前”指 0.1.2 基线，保留用于说明实施依据。

| 状态 | 能力与验收边界 |
| --- | --- |
| 已实现并实际验证 | 三栏设备工作台、搜索/启动/停止/切换设备、Home/Back/真实设备 PNG、中文与复杂字面文本回显；长按/双击/拖拽以 fixture 计数验证；可搜索 UI 树、节点属性/边框与按 id 点击；应用过滤 Hilog、操作事件；HAP 选择安装/启动和按设备保存应用记录 |
| 已实现并实际验证 | Mate X7 展开/合拢/展开，分辨率改变后重建会话并以点击计数验证新坐标；旋转命令后恢复操作；电量 100→37→100，并核对状态栏 |
| 已实现，验证范围有限 | `hos_preview_retry` / 会话隔离 / ETag304；后台 SCK 停帧仍依赖 HDC 降级。GPS、传感器、音量、充电状态与场景提供官方 CLI 参数映射，未证明业务应用实际收到数据；HAP 拖放与滚轮有网页入口，不能由文件选择/滑动验收代替 |
| 已实现参数入口，待目标工程验收 | `hos_run` 的 `apply` / `hotReloadApply`，只应用已有 `.hvigor` 变更清单；未托管 watch 会话，也未证明签名工程的真实热更新 |
| 保持未支持 | 摄像头媒体注入、弱网/断网自动化、系统主题/字体/屏幕朗读开关、任意多指轨迹；已查官方 GUI/测试框架资料，尚无本机稳定 CLI 入口，见第 4 节 |
| 后续按需求评估 | 同页多流、远程协作、视频编码、持续帧率/延迟基准、预编译发行件与 npm 公共发布 |

本版不引入前端框架或新运行依赖。网页和 29 个设备 MCP 工具共享适配层与单活动设备会话。设备身份使用连接设备的唯一名称匹配重建，修复本机 CLI 1.3.0 模拟器列表按数组顺序配错 serial 的问题；不确定身份不绑定窗口或显示场景控制。

下一轮可先在实际目标工程验证增量部署，再选择 GPS/传感器业务回读或高帧率采集之一；涉及平台接口的功能需先取得可调用证据，不用按钮模拟支持。
