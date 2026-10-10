---
name: harmonyos-workflow
description: Build, install, launch or inspect HarmonyOS apps with DevEco CLI and the device MCP. Use for project setup, incremental deployment, application logs, UI interactions and emulator scenarios.
---

# HarmonyOS development on macOS

1. Run `hos_doctor`. Resolve missing CLI/SDK/HDC before device operations. Read the bundled [official DevEco CLI Skill](../deveco-cli/SKILL.md) for project and command workflows; verify installed command help when options differ. Before ArkUI implementation or review, read the [official ArkUI Skill](../hmos-arkui-develop-skill/SKILL.md) and follow its reference routes.
2. Identify the project containing `build-profile.json5`. List connected devices with `hos_devices` and local emulators with `hos_emulators`. Pin the serial explicitly when several devices exist. Start an existing emulator with `hos_emulator_start`, then wait until its serial appears. `hos_emulator_stop` stops an instance; it does not delete it or uninstall applications.
3. Use `hos_run` with an absolute project path for build/install/launch; use `hos_build`, `hos_install` or `hos_launch` for separate stages. Preserve installed app data. Signing changes or uninstall require explicit user intent. The workflow records the last install/launch by device; `application` metadata is not the current foreground app.
4. Read visible controls with `hos_ui_tree`. Prefer node IDs for tap, double-tap, long-press or text; `hos_tap`, `hos_doubletap` and `hos_longpress` accept either an id or device pixel coordinates. `hos_swipe` and `hos_drag` use device pixels. Get current dimensions with `hos_screenshot`; emulator window pixels are different. Execute focus-dependent actions in order and prefer `hos_text`: the verified CLI 1.3.0 wrapper can truncate spaces, while this plugin's HDC path preserves quoted and Unicode text (device API 18+).
5. Verify the resulting screenshot/tree after critical interactions. Use bounded `hos_logs` with bundle/keyword/level/tail/crash filters and `hos_events` for recorded outcomes and duration; a successful command alone does not prove the app changed. Report the actual device/OS and unverified platforms. For browser preview or file-drop installation, follow [browser QA](../harmonyos-browser-qa/SKILL.md).

## Incremental deployment

`hos_run` accepts `apply:true` or `hotReloadApply:true`, mutually exclusive, together with `changeFile`. The value must be an existing changed-file list basename in the project's `.hvigor/` directory, without a path or leading dash. Neither mode accepts `skipBuild`.

- `apply` incrementally compiles/deploys changed files and restarts the app.
- `hotReloadApply` applies changes to an already running official hot-reload watch session; it does not start a watch daemon. Use the official CLI workflow to establish that session and verify the application result on the target project.

## Emulator scenarios

Use `hos_emulator_control` with an explicit emulator name/serial, a `command`, and exactly one supported setting per call (power takes no setting). Commands cover rotate, fold, battery, geolocation, sensor, volume, power and scene; consult its current MCP schema for allowed fields and bounds. Read before/after UI or device state for the requested scenario, then restore settings changed for QA when the task requires it.

The browser exposes rotation, battery level/charging status, latitude/longitude, steps, volume and power. Its folding UI only shows open/half-open/close for `deviceType=foldable`; widefold and other state mappings remain unverified. Official CLI-wide fold values in the MCP schema do not establish support on a particular model. Controlling the active preview's emulator changes its session and can require fresh frames/calibration before further preview input.

## Official tooling and limits

The device MCP exposes 29 `hos_*` tools. `deveco-code` is the installed `devecocli serve mcp`, reused without modifications; its project root comes from `PROJECT_PATH` or the host working directory. Use it in the target project or configure `PROJECT_PATH` before starting it. Its `check`/LSP tools provide code diagnostics; device workflows use the separate `harmonyos` MCP.

Official capability-specific Skills remain upstream. Discover them with `devecocli skills find <keyword>` and install only the needed skill to an explicit destination after reviewing its source/license. Read [setup and limits](../../README.md) for installation and tool compatibility; actual acceptance evidence remains in [validation](../../docs/validation.md).
