---
name: harmonyos-workflow
description: Build, install, launch, inspect or debug HarmonyOS apps on macOS using official DevEco CLI and the device MCP. Use for HarmonyOS project setup, device deployment, screenshots, UI trees and application logs.
---

# HarmonyOS development on macOS

1. Run `hos_doctor`. Resolve missing CLI/SDK/HDC before device operations. Read the bundled [official DevEco CLI Skill](../deveco-cli/SKILL.md) for project and command workflows. Verify installed command help when options differ.
   For ArkUI UI implementation or review, read the [official ArkUI Skill](../hmos-arkui-develop-skill/SKILL.md) and follow its task-specific reference routes.
2. Identify the project containing `build-profile.json5` and list devices with `hos_devices`. Pin the serial explicitly when multiple devices exist. Start an existing emulator with `hos_emulator_start` when needed; wait until it appears in `hos_devices`.
3. Prefer `hos_run` with an absolute project path for build/install/launch. Use `hos_build`, `hos_install` and `hos_launch` when separate stages are required. Preserve installed app data; signing changes and uninstall require explicit user intent.
4. Read visible controls with `hos_ui_tree`; use node IDs for taps/text when available. Device pixel coordinates belong to the HDC screenshot, not the emulator window. Collect `hos_screenshot` plus bounded `hos_logs` after the target action.
   Execute actions that depend on focus/state in order. Prefer `hos_text` for text: the verified CLI 1.3.0 wrapper can truncate spaces; this plugin's HDC path preserves quoted and Unicode input (device API 18+).
5. Complete the requested interaction and verify the resulting tree/state. Report the real device/OS, outcome and any unverified platforms. Follow [browser QA](../harmonyos-browser-qa/SKILL.md) when a browser preview is requested.

The `deveco-code` MCP is the installed `devecocli serve mcp`, reused without modifications. Its project root comes from `PROJECT_PATH` or the host working directory. Use it in the target project, or configure `PROJECT_PATH` explicitly before starting it. Its `check`/LSP tools perform code diagnostics; device tools use the separate `harmonyos` MCP.

Official capability-specific Skills remain upstream. Discover them with `devecocli skills find <keyword>` and install only the needed skill to an explicit destination after reviewing its source/license. Read [setup and limits](../../README.md) for installation and tool compatibility.
