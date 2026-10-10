# macOS capture helper

Build with `node scripts/build-native.mjs` (Xcode command line tools, macOS 14+).
The output is `native/bin/hos-capture`, compiled for the current Mac's architecture.
No third-party runtime or library is required.

```sh
native/bin/hos-capture doctor
native/bin/hos-capture windows
native/bin/hos-capture capture --window-id 123 --output /absolute/frame-directory --fps 10
```

`doctor` and `windows` never request Screen Recording permission. Without permission,
window titles may be unavailable. Only `permission` explicitly calls
`CGRequestScreenCaptureAccess`; the operator must approve the system dialog.
`capture` refuses to run unless the existing preflight permission check succeeds.
After a permission change, macOS may require restarting the host process.

Capture uses ScreenCaptureKit's `desktopIndependentWindow` filter to select one
window. Audio, microphone and cursor capture are disabled. Complete frames become
an atomically replaced `latest.jpg`. Each image emits one JSON line on stdout with
pixel dimensions, capture time and available `contentRect`, `contentScale`,
`scaleFactor` metadata. Diagnostics go to stderr. SIGINT/SIGTERM stop the stream.
Independently, stdout emits a `state` JSON line every second with `windowId`,
`onScreen`, current `width`/`height` in window points and `observedAt`. These
observations use all-window CoreGraphics discovery and never update `latest.jpg`.
A missing window has `onScreen: false`, zero dimensions and `missing: true`.

The selected window includes the emulator's surrounding controls. `contentRect`
describes ScreenCaptureKit's content region, **not** the device touchscreen region.
The browser must explicitly calibrate/crop the device viewport before mapping
pointer positions to HDC device coordinates. Native frame metadata is retained
without pretending it already describes the device viewport. Output resolution
is fixed to the window's initial pixel size; ScreenCaptureKit can scale/letterbox
the content after window resizing, so recalibrate after resize or rotation.

Non-complete frames do not update the JPEG or its capture timestamp. A minimized,
closed or suspended window may stop producing usable frames. Callers use a fresh
healthy `state` plus an existing frame to retain a static preview; `onScreen: false`
selects the HDC screenshot fallback, including fully offscreen windows. Missing
observations/frames also require fallback. Changes in point bounds invalidate the
device viewport calibration because capture output dimensions remain fixed.
Background and minimized behavior depends on the emulator and macOS and needs
real acceptance.
ScreenCaptureKit may also omit new frames for an unchanged window: 10 fps is a
maximum cadence, not a promise that a static screen produces ten images per second.
Frame timestamp age alone therefore cannot distinguish static content from
suspension. State observations describe window visibility and bounds, not a
guarantee that the emulator application is responsive.

Run `node native/check.mjs` for command/argument checks. Add an explicitly selected
window ID (`node native/check.mjs 123`) to verify live JPEG output, metadata and
graceful SIGTERM using existing permission. The check leaves its captured JPEG in
the printed temporary directory for visual inspection.

## Local evidence (2026-10-09)

Built successfully using Apple Swift 6.2.4 on arm64 macOS 15.7.9 with deployment
target macOS 14. Existing permission preflight returned `true`; no permission
request was executed. Read-only window discovery found the selected emulator window at
1043×681 points. A 3-second capture produced one complete 2086×1362 JPEG of the
static emulator screen, including its device bezel and controls; no other desktop
window appeared in the inspected image. JSON metadata, JPEG signature, argument
rejection and graceful SIGTERM exit 0 passed `native/check.mjs WINDOW_ID`.
After adding window state observations, rebuilding and rerunning the same check
passed with one complete image and three valid state lines over three seconds.

macOS 14 runtime, Intel compilation/runtime, permission denial UI, dynamic frame
cadence, foreground/background/minimized transitions and resize/rotation mapping
are not established by this check. Browser/HDC coordinate acceptance belongs to
the enclosing serve-hos workflow.

API sources: [Apple capture sample](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos),
[window filter](https://developer.apple.com/documentation/screencapturekit/sccontentfilter/init(desktopindependentwindow:)),
[frame metadata](https://developer.apple.com/documentation/screencapturekit/scstreamframeinfo),
[permission preflight](https://developer.apple.com/documentation/coregraphics/cgpreflightscreencaptureaccess()).
