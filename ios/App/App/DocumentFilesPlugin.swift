import Foundation
import UIKit
import ImageIO
import Vision
import Capacitor

/// Local document operations only. No photo-library permission, network OCR,
/// or finance-document logging. Export and share are deliberately separate.
@objc(DocumentFilesPlugin)
public final class DocumentFilesPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
    public let identifier = "DocumentFilesPlugin"
    public let jsName = "DocumentFiles"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "savePdf", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sharePdf", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recognizeImage", returnType: CAPPluginReturnPromise)
    ]

    private let work = DispatchQueue(label: "wallet.diary.documents", qos: .userInitiated)
    private let workSlots = DispatchSemaphore(value: 2)
    // Accessed only on the main queue. Only one native sheet can own a call.
    private var pdfCall: CAPPluginCall?
    private var pdfToken: UUID?
    private var pdfFile: URL?
    private weak var pdfController: UIViewController?
    private var pdfOperation = ""

    private enum DocumentError: Error {
        case size, invalidPDF, imageFormat, languageUnavailable, limit
        var code: String {
            switch self {
            case .size: return "size"
            case .invalidPDF: return "invalid-pdf"
            case .imageFormat: return "image-format"
            case .languageUnavailable: return "ocr-language-unavailable"
            case .limit: return "limit"
            }
        }
    }

    @objc func savePdf(_ call: CAPPluginCall) { beginPDF(call, operation: "saved") }
    @objc func sharePdf(_ call: CAPPluginCall) { beginPDF(call, operation: "shared") }

    private func beginPDF(_ call: CAPPluginCall, operation: String) {
        DispatchQueue.main.async {
            guard self.pdfCall == nil else { call.reject("document-busy"); return }
            guard let presenter = self.bridge?.viewController,
                  presenter.viewIfLoaded?.window != nil,
                  presenter.presentedViewController == nil else { call.reject("document-ui-unavailable"); return }
            guard self.workSlots.wait(timeout: .now()) == .success else { call.reject("document-busy"); return }
            let token = UUID()
            self.pdfCall = call
            self.pdfToken = token
            self.pdfOperation = operation
            self.bridge?.saveCall(call)
            let encoded = call.getString("base64") ?? ""
            let filename = call.getString("filename") ?? "wallet-diary.pdf"
            self.work.async {
                defer { self.workSlots.signal() }
                do {
                    let file = try Self.preparePDF(encoded, filename: filename)
                    DispatchQueue.main.async {
                        guard self.pdfToken == token else { Self.removeTemporaryPDF(file); return }
                        self.pdfFile = file
                        guard presenter.viewIfLoaded?.window != nil,
                              presenter.presentedViewController == nil else {
                            self.finishPDF(token: token, error: "document-ui-unavailable"); return
                        }
                        if operation == "saved" {
                            let picker = UIDocumentPickerViewController(forExporting: [file], asCopy: true)
                            self.pdfController = picker
                            picker.delegate = self
                            picker.allowsMultipleSelection = false
                            presenter.present(picker, animated: true) {
                                picker.presentationController?.delegate = self
                            }
                        } else {
                            let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
                            self.pdfController = sheet
                            sheet.completionWithItemsHandler = { _, completed, _, error in
                                DispatchQueue.main.async {
                                    self.finishPDF(token: token, completed: completed, error: error == nil ? nil : "share-pdf")
                                }
                            }
                            // Required for iPad; an unanchored popover raises an exception.
                            sheet.popoverPresentationController?.sourceView = presenter.view
                            sheet.popoverPresentationController?.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
                            sheet.popoverPresentationController?.permittedArrowDirections = []
                            presenter.present(sheet, animated: true) {
                                sheet.presentationController?.delegate = self
                            }
                        }
                    }
                } catch {
                    let code = (error as? DocumentError)?.code ?? "prepare-pdf"
                    DispatchQueue.main.async { self.finishPDF(token: token, error: code) }
                }
            }
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard controller === pdfController, pdfOperation == "saved", let token = pdfToken else { return }
        // For export-as-copy, the system invokes this after exporting. Merely
        // presenting the picker or cancelling it is never reported as saved.
        finishPDF(token: token, completed: !urls.isEmpty)
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard controller === pdfController, let token = pdfToken else { return }
        finishPDF(token: token, completed: false)
    }

    public func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        guard presentationController.presentedViewController === pdfController, let token = pdfToken else { return }
        finishPDF(token: token, completed: false)
    }

    private func finishPDF(token: UUID, completed: Bool = false, error: String? = nil) {
        guard pdfToken == token, let call = pdfCall else { return }
        let file = pdfFile
        let operation = pdfOperation
        pdfCall = nil; pdfToken = nil; pdfFile = nil; pdfController = nil; pdfOperation = ""
        if let error = error { call.reject(error) }
        else { call.resolve([operation: completed]) }
        bridge?.releaseCall(call)
        if let file = file { work.async { Self.removeTemporaryPDF(file) } }
    }

    private static func boundedData(_ encoded: String) throws -> Data {
        guard !encoded.isEmpty, encoded.utf8.count <= 53_333_336,
              let bytes = Data(base64Encoded: encoded), !bytes.isEmpty,
              bytes.count <= 40_000_000 else { throw DocumentError.size }
        return bytes
    }

    private static func preparePDF(_ encoded: String, filename: String) throws -> URL {
        let bytes = try boundedData(encoded)
        guard bytes.starts(with: [0x25, 0x50, 0x44, 0x46, 0x2d]) else { throw DocumentError.invalidPDF }
        let manager = FileManager.default
        let root = manager.temporaryDirectory.appendingPathComponent("wallet-document-pdfs", isDirectory: true)
        try manager.createDirectory(at: root, withIntermediateDirectories: true)
        // Crash leftovers are temporary exports, never the user's chosen copy.
        pruneOldPDFs(root)
        let session = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try manager.createDirectory(at: session, withIntermediateDirectories: false,
                                    attributes: [.protectionKey: FileProtectionType.complete])
        var name = filename.components(separatedBy: CharacterSet(charactersIn: "/\\:*?\"<>|").union(.controlCharacters)).joined(separator: "-")
        name = String(name.prefix(100)).trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty || name == "." || name == ".." { name = "wallet-diary.pdf" }
        if !name.lowercased().hasSuffix(".pdf") { name += ".pdf" }
        let file = session.appendingPathComponent(name, isDirectory: false)
        do { try bytes.write(to: file, options: [.atomic, .completeFileProtection]) }
        catch { try? manager.removeItem(at: session); throw error }
        return file
    }

    private static func pruneOldPDFs(_ root: URL) {
        let manager = FileManager.default
        let keys: Set<URLResourceKey> = [.isDirectoryKey, .isSymbolicLinkKey, .contentModificationDateKey]
        guard let sessions = try? manager.contentsOfDirectory(at: root, includingPropertiesForKeys: Array(keys)) else { return }
        for session in sessions.prefix(512) {
            guard UUID(uuidString: session.lastPathComponent) != nil,
                  let values = try? session.resourceValues(forKeys: keys), values.isDirectory == true,
                  values.isSymbolicLink != true,
                  let modified = values.contentModificationDate,
                  modified < Date().addingTimeInterval(-86_400) else { continue }
            try? manager.removeItem(at: session)
        }
    }

    private static func removeTemporaryPDF(_ file: URL) {
        let session = file.deletingLastPathComponent()
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("wallet-document-pdfs", isDirectory: true)
        guard UUID(uuidString: session.lastPathComponent) != nil,
              session.deletingLastPathComponent().standardizedFileURL == root.standardizedFileURL else { return }
        try? FileManager.default.removeItem(at: session)
    }

    @objc func recognizeImage(_ call: CAPPluginCall) {
        guard workSlots.wait(timeout: .now()) == .success else { call.reject("document-busy"); return }
        let encoded = call.getString("base64") ?? ""
        let language = call.getString("language") ?? "en"
        work.async {
            defer { self.workSlots.signal() }
            do {
                let lines: [[String: Any]] = try autoreleasepool {
                    let bytes = try Self.boundedData(encoded)
                    guard let source = CGImageSourceCreateWithData(bytes as CFData, nil) else { throw DocumentError.imageFormat }
                    // Decode a bounded, EXIF-oriented thumbnail rather than a
                    // potentially enormous full resolution image into memory.
                    let options: [CFString: Any] = [
                        kCGImageSourceCreateThumbnailFromImageAlways: true,
                        kCGImageSourceCreateThumbnailWithTransform: true,
                        kCGImageSourceThumbnailMaxPixelSize: 3000,
                        kCGImageSourceShouldCacheImmediately: true
                    ]
                    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary),
                          image.width > 0, image.height > 0,
                          image.width <= 3000, image.height <= 3000 else { throw DocumentError.imageFormat }
                    let request = VNRecognizeTextRequest()
                    request.recognitionLevel = .accurate
                    // Do not "correct" unfamiliar merchant names or numbers.
                    request.usesLanguageCorrection = false
                    let supported = try request.supportedRecognitionLanguages()
                    let script = String(language.lowercased().prefix(2))
                    let preferred = script == "en" || script == "fr" ? [script, script == "en" ? "fr" : "en"] : [script, "en"]
                    guard supported.contains(where: { $0.lowercased().hasPrefix(script) }) else { throw DocumentError.languageUnavailable }
                    request.recognitionLanguages = preferred.compactMap { prefix in supported.first { $0.lowercased().hasPrefix(prefix) } }
                    try VNImageRequestHandler(cgImage: image, orientation: .up, options: [:]).perform([request])
                    let observations = request.results ?? []
                    guard observations.count <= 10_000 else { throw DocumentError.limit }
                    var output: [[String: Any]] = []
                    var characterCount = 0
                    for observation in observations {
                        guard let candidate = observation.topCandidates(1).first else { continue }
                        let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
                        if text.isEmpty { continue }
                        characterCount += text.utf8.count
                        guard characterCount <= 2_000_000 else { throw DocumentError.limit }
                        let rect = observation.boundingBox
                        // Vision's origin is bottom-left; the JS table reader
                        // expects pixel coordinates with a top-left origin.
                        output.append([
                            "text": text,
                            "x": max(0, rect.minX * CGFloat(image.width)),
                            "y": max(0, (1 - rect.maxY) * CGFloat(image.height)),
                            "height": max(1, rect.height * CGFloat(image.height)),
                            "width": max(1, rect.width * CGFloat(image.width))
                        ])
                    }
                    return output
                }
                call.resolve(["lines": lines])
            } catch {
                // Only bounded error codes cross the bridge; never source text.
                call.reject((error as? DocumentError)?.code ?? "ocr-failed")
            }
        }
    }
}
