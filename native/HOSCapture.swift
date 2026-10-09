import AppKit
import CoreImage
import CoreMedia
import Darwin
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

func log(_ message: String) {
    FileHandle.standardError.write(Data((message + "\n").utf8))
}

func emit(_ value: Any) throws {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .fragmentsAllowed])
    FileHandle.standardOutput.write(data + Data([10]))
}

struct CaptureOptions {
    let windowID: CGWindowID
    let output: URL
    let fps: Int

    init(_ args: [String]) throws {
        guard args.count % 2 == 0 else { throw CaptureError("Options require values") }
        var options: [String: String] = [:]
        for i in stride(from: 0, to: args.count, by: 2) {
            guard ["--window-id", "--output", "--fps"].contains(args[i]), options[args[i]] == nil else {
                throw CaptureError("Unknown or repeated option: \(args[i])")
            }
            options[args[i]] = args[i + 1]
        }
        guard let id = options["--window-id"].flatMap(UInt32.init), id > 0,
              let directory = options["--output"], directory.hasPrefix("/"),
              let rate = Int(options["--fps"] ?? "10"), (1...60).contains(rate) else {
            throw CaptureError("capture requires --window-id ID --output ABS_DIR [--fps 1...60]")
        }
        windowID = id
        output = URL(fileURLWithPath: directory, isDirectory: true)
        fps = rate
    }
}

struct CaptureError: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

final class FrameWriter: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    let output: URL
    let context = CIContext()
    let lock = NSLock()
    private var stopping = false
    private var failure: String?
    private var lastStatus: Int?

    init(output: URL) { self.output = output }

    func stop(error: String? = nil) {
        lock.lock()
        stopping = true
        if let error { failure = error }
        lock.unlock()
    }

    var state: (stopping: Bool, failure: String?) {
        lock.lock()
        defer { lock.unlock() }
        return (stopping, failure)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        stop(error: error.localizedDescription)
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, buffer.isValid, !state.stopping,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(buffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let info = attachments.first,
              let rawStatus = info[.status] as? Int else { return }
        guard rawStatus == SCFrameStatus.complete.rawValue else {
            if lastStatus != rawStatus { log("ScreenCaptureKit frame status: \(rawStatus); no new image") }
            lastStatus = rawStatus
            return
        }
        lastStatus = rawStatus
        guard let pixels = buffer.imageBuffer else { return }
        let width = CVPixelBufferGetWidth(pixels)
        let height = CVPixelBufferGetHeight(pixels)
        let image = CIImage(cvPixelBuffer: pixels)
        guard let cgImage = context.createCGImage(image, from: image.extent) else {
            stop(error: "Cannot convert captured pixels")
            return
        }
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else {
            stop(error: "Cannot create JPEG encoder")
            return
        }
        CGImageDestinationAddImage(destination, cgImage, [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else {
            stop(error: "Cannot encode captured frame")
            return
        }
        do {
            try (data as Data).write(to: output.appendingPathComponent("latest.jpg"), options: .atomic)
            var frame: [String: Any] = ["type": "frame", "width": width, "height": height,
                                       "capturedAt": ISO8601DateFormatter().string(from: Date())]
            if let dictionary = info[.contentRect] as? [String: Any],
               let rect = CGRect(dictionaryRepresentation: dictionary as CFDictionary) {
                frame["contentRect"] = ["x": rect.origin.x, "y": rect.origin.y,
                                        "width": rect.width, "height": rect.height]
            }
            for (key, name) in [(SCStreamFrameInfo.contentScale, "contentScale"), (.scaleFactor, "scaleFactor")] {
                if let value = info[key] as? NSNumber { frame[name] = value }
            }
            try emit(frame)
        } catch { stop(error: error.localizedDescription) }
    }
}

@main
struct HOSCapture {
    @MainActor
    static func main() async {
        // A CLI must initialize AppKit before ScreenCaptureKit talks to the window server.
        NSApplication.shared.setActivationPolicy(.prohibited)
        do {
            let args = Array(CommandLine.arguments.dropFirst())
            switch args.first {
            case "doctor":
                guard args.count == 1 else { throw CaptureError("doctor takes no options") }
                try emit(["permission": CGPreflightScreenCaptureAccess(),
                          "macOS": ProcessInfo.processInfo.operatingSystemVersionString])
            case "permission":
                guard args.count == 1 else { throw CaptureError("permission takes no options") }
                try emit(CGRequestScreenCaptureAccess())
            case "windows":
                guard args.count == 1 else { throw CaptureError("windows takes no options") }
                let windows = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
                let values = windows.compactMap { window -> [String: Any]? in
                    guard let id = window[kCGWindowNumber as String] as? NSNumber,
                          let bounds = window[kCGWindowBounds as String] as? [String: Any],
                          let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary), rect.width > 0, rect.height > 0,
                          (window[kCGWindowLayer as String] as? Int) == 0 else { return nil }
                    let pid = (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value ?? 0
                    let app = NSRunningApplication(processIdentifier: pid)
                    return ["id": id, "pid": pid, "title": window[kCGWindowName as String] as? String ?? "",
                            "owner": window[kCGWindowOwnerName as String] as? String ?? "",
                            "bundleId": app?.bundleIdentifier ?? "", "width": rect.width, "height": rect.height,
                            "onScreen": window[kCGWindowIsOnscreen as String] as? Bool ?? false]
                }
                try emit(values)
            case "capture":
                let options = try CaptureOptions(Array(args.dropFirst()))
                guard CGPreflightScreenCaptureAccess() else {
                    throw CaptureError("Screen Recording permission is missing; explicitly run permission or grant it in System Settings")
                }
                try await capture(options)
            default:
                throw CaptureError("Usage: hos-capture doctor | windows | permission | capture --window-id ID --output ABS_DIR [--fps 10]")
            }
        } catch {
            log(String(describing: error))
            exit(1)
        }
    }

    @MainActor
    static func capture(_ options: CaptureOptions) async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
        guard let window = content.windows.first(where: { $0.windowID == options.windowID }) else {
            throw CaptureError("Selected window is unavailable: \(options.windowID)")
        }
        try FileManager.default.createDirectory(at: options.output, withIntermediateDirectories: true)
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let config = SCStreamConfiguration()
        config.width = max(1, Int(filter.contentRect.width * CGFloat(filter.pointPixelScale)))
        config.height = max(1, Int(filter.contentRect.height * CGFloat(filter.pointPixelScale)))
        config.minimumFrameInterval = CMTime(value: 1, timescale: Int32(options.fps))
        config.queueDepth = 3
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.showsCursor = false
        config.capturesAudio = false
        config.ignoreShadowsSingleWindow = true
        if #available(macOS 15.0, *) { config.captureMicrophone = false }
        let writer = FrameWriter(output: options.output)
        let stream = SCStream(filter: filter, configuration: config, delegate: writer)
        try stream.addStreamOutput(writer, type: .screen, sampleHandlerQueue: DispatchQueue(label: "hos-capture.frames"))
        let signals = [SIGTERM, SIGINT].map { signalNumber -> DispatchSourceSignal in
            signal(signalNumber, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: .global())
            source.setEventHandler { writer.stop() }
            source.resume()
            return source
        }
        defer { signals.forEach { $0.cancel() } }
        try await stream.startCapture()
        var nextObservation: TimeInterval = 0
        while !writer.state.stopping {
            if ProcessInfo.processInfo.systemUptime >= nextObservation {
                let windows = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
                let current = windows.first { ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value == options.windowID }
                let bounds = current?[kCGWindowBounds as String] as? [String: Any]
                let rect = bounds.flatMap { CGRect(dictionaryRepresentation: $0 as CFDictionary) } ?? .zero
                var state: [String: Any] = ["type": "state", "windowId": options.windowID,
                    "onScreen": current?[kCGWindowIsOnscreen as String] as? Bool ?? false,
                    "width": rect.width, "height": rect.height,
                    "observedAt": ISO8601DateFormatter().string(from: Date())]
                if current == nil { state["missing"] = true }
                try emit(state)
                nextObservation = ProcessInfo.processInfo.systemUptime + 1
            }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        try await stream.stopCapture()
        if let failure = writer.state.failure { throw CaptureError(failure) }
    }
}
