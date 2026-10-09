---
name: harmonyos-browser-qa
description: Preview and operate a HarmonyOS device in the serve-hos browser workbench. Use for device switching, ScreenCaptureKit calibration, HAP installation, UI inspection and interaction acceptance.
---

# Browser device workbench

1. List connected devices, local emulators and macOS capture windows. Start `hos_preview_start` with the selected serial when known; an unbound workbench can also start when no device or several devices are connected. Use an explicit window ID if the correct emulator window cannot be uniquely matched. `source:auto` prefers ScreenCaptureKit and falls back to HDC screenshots when capture is unavailable.
2. Open the exact returned loopback URL including its fragment token. The left panel searches devices and existing local emulators, starts/stops instances and selects one active device. Each service has one active preview device. Verify a real frame and healthy `hos_preview_status`, rather than accepting page load as capture evidence.
3. For ScreenCaptureKit, enable calibration to show the full emulator window, then drag-select the actual touchscreen rectangle excluding bezel/toolbars/letterboxing. `hos_preview_calibrate` accepts that normalized full-window rectangle and optional `session`. Match orientation with a current `hos_screenshot`, tap a harmless known control and verify its resulting UI tree. The normal view crops to the touchscreen and maps input back to full-window normalized coordinates.
4. Use tap/swipe mode, double-tap/long-press modes, press-and-hold, drag mode or wheel-to-swipe as needed. Focus a device field, enter or paste text in the workbench textarea, then send; composition input is retained until explicit submission. MCP `hos_preview_input` uses normalized full-frame points or visible node ids; direct `hos_tap`/`hos_swipe` and related tools use device pixels. Home/Back and device PNG screenshot controls are available in the center toolbar.
5. In the right panel, read the UI tree, search by text/type/id, inspect properties and bounds highlighting, then operate a selected id when available. Read bounded logs with Bundle/keyword/level/crash filters. Operation history records command outcomes and duration, not proof of UI response. Verify resulting screenshot/tree after each critical action, including completion of keyboard or screen transitions.
6. End with `hos_preview_stop`, which stops only this process's capture/listener. Standalone CLI sessions require Ctrl+C or SIGTERM; closing the browser leaves the service running. For reproducible end-to-end checks, use the [acceptance workflow](../../docs/validation.md).

## Device and capture session changes

Use the left panel or `hos_preview_select` to change devices. Use the capture-source selector and retry button, or `hos_preview_retry`, to recover/reselect SCK or HDC without changing the URL/token. Pass the latest `hos_preview_status.session` to preview actions when coordinating with other clients; stale sessions are rejected.

Device selection, capture retry and emulator scenarios update the session and reset capture/calibration. The page clears old frames, tree, text and logs, disables input during switching, and resumes screen interaction only after a matching-session frame arrives. Frame requests use ETag/304 for unchanged frames; an unavailable current-session frame is not treated as a valid old image.

Window/device size changes downgrade to HDC; metadata/scale changes clear calibration. ScreenCaptureKit observes window health separately from image frames so static screens stay valid. Minimized, closed, fully offscreen or stalled background windows fall back to HDC. Restore the window, explicitly retry SCK and recalibrate. Frame freshness and window presence do not prove that the emulator/app is responsive; HDC remains a lower-frame-rate screenshot fallback.

Screen Recording grants belong to the user. Run `serve-hos permission` only when they intend to grant access, then restart the helper/host if macOS requests it. HDC fallback requires no screen permission. First-run input-method agreements are completed by the user; inspect system windows if the intended field is absent.

## Applications and scenarios

Select a `.hap` file in the application panel or drop one into the central viewport. The browser upload limit is 128 MiB; installation shares the operation queue and session check. Install/launch needs a selected device, not a fresh frame. After installation, use the extracted Bundle/Ability or enter them manually to launch. The panel shows this process's most recent install/launch metadata, **not the current foreground application**; unavailable HAP metadata requires manual entry. There is no uninstall/delete entry.

The simulator panel provides rotation, battery level/charging status, latitude/longitude, steps, volume and power. Power remains usable without a fresh frame so a sleeping emulator can be restored. Folding shows open/half-open/close only for `deviceType=foldable`; other model mappings remain unverified. Additional CLI sensor/scene controls are available through `hos_emulator_control`; use only fields defined by the current tool schema and verify requested state on the actual target.
