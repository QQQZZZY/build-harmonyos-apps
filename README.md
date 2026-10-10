# Build HarmonyOS Apps

macOS 本地 HarmonyOS 构建、运行与调试插件，插件源码在 [`build-harmonyos-apps/`](build-harmonyos-apps/)。
复用已安装的 Huawei DevEco CLI、HDC、官方 DevEco CLI Skill 和 ArkUI Skill，提供设备 MCP、ScreenCaptureKit 浏览器预览及 HDC 截图降级。

插件能力、独立运行方式与详细边界见 [插件说明](build-harmonyos-apps/README.md)，许可和上游来源见其中「官方内容与许可证」。

安装后需要本机具备 Node.js 22+、已安装的 DevEco CLI 和配套 HarmonyOS SDK；窗口捕获另需 macOS 14+ 与 Xcode Command Line Tools，缺失时自动降级 HDC。

## Codex 安装

从 GitHub 安装 Marketplace：

```bash
codex plugin marketplace add QQQZZZY/build-harmonyos-apps
```

本地目录方式：本仓库已包含 `.agents/plugins/marketplace.json`，在 Codex CLI 中将该仓库根目录加入本地 Marketplace 后，从 `harmonyos-local` 源安装 **Build HarmonyOS Apps**。

## ZCode 安装

本仓库同时提供 ZCode 插件适配：ZCode 清单在 [`build-harmonyos-apps/.zcode-plugin/plugin.json`](build-harmonyos-apps/.zcode-plugin/plugin.json)，本地市场目录为根级 [`marketplace.json`](marketplace.json)（市场名 `build-harmonyos-apps`）。Skills 与 MCP 服务由 Codex / ZCode 两端共享，功能一致。

1. ZCode Desktop 打开 **插件市场 → 添加 → 添加插件市场**，粘贴本仓库根目录的绝对路径（即 `marketplace.json` 所在目录）。
2. 在该市场中选择 **Build HarmonyOS Apps** 并安装。
3. 新建任务试用：例如「使用 Build HarmonyOS Apps 构建、运行并验证当前鸿蒙项目」。

运行依赖与 Codex 侧相同；首次启动 `harmonyos` MCP 时若缺少 Node 依赖会自动联网安装。
