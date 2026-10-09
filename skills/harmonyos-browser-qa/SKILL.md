---
name: harmonyos-browser-qa
description: Preview and interact with a HarmonyOS emulator or device in a local browser using serve-hos. Use for browser device mirroring, ScreenCaptureKit calibration, screenshots and end-to-end UI acceptance.
---

# Browser device preview

1. List connected devices and macOS capture windows. Start `hos_preview_start` with the selected serial. Use one visible emulator window; when several exist, pass its explicit window ID. `source:auto` prefers ScreenCaptureKit and downgrades to HDC screenshots when capture is unavailable.
2. Open the exact returned loopback URL including its fragment token. Verify a real device frame is rendered and `hos_preview_status` is healthy. The page alone does not prove capture works.
3. For ScreenCaptureKit, drag-select the actual touchscreen rectangle in the browser. Exclude bezel, toolbar and letterboxing. `hos_preview_calibrate` accepts the same normalized rectangle. Match its orientation against a current `hos_screenshot`; then tap a harmless known control and verify its resulting UI tree before accepting coordinate mapping.
4. Click to tap, drag to swipe, or use text entry after focusing the device field. MCP preview input uses normalized full-frame points; `hos_tap`/`hos_swipe` use device pixels. Window/device size changes downgrade to HDC; stop/start to retry SCK and recalibrate. Metadata/scale changes clear calibration. First-run input-method agreements are completed by the user; inspect system windows if the expected field is absent.
5. Check an actual state change via screenshot/tree after each critical interaction. For E2E use the reproducible [acceptance workflow](../../docs/validation.md). End with `hos_preview_stop`, which stops only this process's capture and listener. Standalone CLI sessions require Ctrl+C or SIGTERM; closing the browser page leaves them running.

ScreenCaptureKit observes window health separately from image frames so static screens stay valid. Minimized, closed or completely offscreen windows downgrade to HDC. Restoring the window requires stop/start to retry ScreenCaptureKit. Screen Recording grants are controlled by the user; use `serve-hos permission` only when they intend to grant access, then restart the helper/host if macOS requests it. HDC fallback does not need screen permission.

Treat screenshot polling as a low-frame-rate fallback. Frame freshness and window presence do not prove the emulator/app is responsive; interaction acceptance must verify the resulting application state.
