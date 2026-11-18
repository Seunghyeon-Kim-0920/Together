import Foundation

/// Private, device-local hand-off from Shortcuts to the existing ledger pipeline.
/// This is deliberately NOT a second writer for the wallet SQLite snapshot.
struct IOSShortcutInput: Codable {
    let id: String
    let queueToken: String
    let kind: String
    let sourceName: String
    let title: String?
    let body: String?
    let receivedAt: Int64
    let amount: String?
    let currency: String?
    let merchant: String?
}

struct IOSAutomationLedger: Codable {
    let ledgerId: String
    let title: String
    let currency: String
    let monthlyLimitMinor: Int64?
    let spentMinor: Int64
    let month: String
    let locale: String
    let automationAllApps: Bool
    let automationSmsNotifications: Bool
}

struct IOSAutomationSource: Codable {
    let packageName: String
    let ledgerId: String
    let currency: String
}

struct IOSAutomationConfiguration: Codable {
    var ledgers: [IOSAutomationLedger] = []
    var sources: [IOSAutomationSource] = []
    var detectAllApps = false
    var detectSmsNotifications = false
}

struct IOSBudgetMarker: Codable {
    let month: String
    let limit: Int64
    let level: Int
}

struct IOSAutomationState: Codable {
    var schema = 1
    var captureEnabled = false
    var lastShortcutReceivedAt: Int64?
    var inputs: [IOSShortcutInput] = []
    var configuration = IOSAutomationConfiguration()
    var budgetMarkers: [String: IOSBudgetMarker] = [:]
}

enum IOSAutomationError: Error, LocalizedError, Equatable {
    case disabled, noLedger, scopeDisabled, invalidInput, inboxFull, unreadable, unavailable

    var errorDescription: String? {
        let key: String
        switch self {
        case .disabled: key = "Enable Shortcuts capture in Wallet Diary first."
        case .noLedger: key = "Create a general ledger in Wallet Diary first."
        case .scopeDisabled: key = "Enable this input source in Wallet Diary first."
        case .invalidInput: key = "The shortcut input is missing required fields or is too large."
        case .inboxFull: key = "The capture inbox is full. Open Wallet Diary to process it, then try again."
        case .unreadable: key = "The capture inbox could not be read. No stored data was replaced."
        case .unavailable: key = "Capture could not be saved. Unlock the device and try again."
        }
        return NSLocalizedString(key, comment: "Shortcuts capture error")
    }
}

final class IOSAutomationInbox {
    static let shared = IOSAutomationInbox()
    static let maxInputs = 1_000
    // Raw financial text has its own limit, independent of trusted-source
    // configuration. Keep these counts aligned with wallet.ts.
    static let maxBytes = 2 * 1_024 * 1_024
    static let maxFileBytes = 16 * 1_024 * 1_024
    static let maxLedgers = 50
    static let maxSources = 50 * 500
    private static let processLock = NSRecursiveLock()
    private let directory: URL

    init(directory: URL? = nil) {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("WalletShortcutInbox", isDirectory: true)
    }

    /// NSFileCoordinator serializes cooperating app/intent processes; the lock
    /// also prevents reentrance by multiple plugin and intent calls in this process.
    private func transaction<T>(write: Bool, _ operation: (inout IOSAutomationState) throws -> T) throws -> T {
        Self.processLock.lock()
        defer { Self.processLock.unlock() }
        let manager = FileManager.default
        do {
            #if os(iOS)
            let directoryAttributes: [FileAttributeKey: Any] = [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
            #else
            // Allows the same storage checks to run on a Mac without an iPhone.
            let directoryAttributes: [FileAttributeKey: Any] = [:]
            #endif
            try manager.createDirectory(at: directory, withIntermediateDirectories: true, attributes: directoryAttributes)
            var resource = URLResourceValues()
            resource.isExcludedFromBackup = true
            var protectedDirectory = directory
            try protectedDirectory.setResourceValues(resource)
        } catch { throw IOSAutomationError.unavailable }
        let file = directory.appendingPathComponent("inbox-v1.json")
        var coordinationError: NSError?
        var result: Result<T, Error>?
        NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: file, options: .forMerging, error: &coordinationError) { coordinatedURL in
            result = Result {
                var state = IOSAutomationState()
                if manager.fileExists(atPath: coordinatedURL.path) {
                    do {
                        let size = try manager.attributesOfItem(atPath: coordinatedURL.path)[.size] as? NSNumber
                        guard let size = size, size.intValue <= Self.maxFileBytes else { throw IOSAutomationError.unreadable }
                        let data = try Data(contentsOf: coordinatedURL)
                        state = try JSONDecoder().decode(IOSAutomationState.self, from: data)
                        guard state.schema == 1, state.inputs.count <= Self.maxInputs,
                              state.configuration.ledgers.count <= Self.maxLedgers,
                              state.configuration.sources.count <= Self.maxSources,
                              try JSONEncoder().encode(state.inputs).count <= Self.maxBytes else { throw IOSAutomationError.unreadable }
                    } catch { throw IOSAutomationError.unreadable }
                }
                let value = try operation(&state)
                if write {
                    guard state.inputs.count <= Self.maxInputs,
                          try JSONEncoder().encode(state.inputs).count <= Self.maxBytes else { throw IOSAutomationError.inboxFull }
                    let data = try JSONEncoder().encode(state)
                    guard data.count <= Self.maxFileBytes else { throw IOSAutomationError.inboxFull }
                    // Protection is set as part of the atomic write, not afterward.
                    #if os(iOS)
                    try data.write(to: coordinatedURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                    #else
                    try data.write(to: coordinatedURL, options: .atomic)
                    #endif
                }
                return value
            }
        }
        if coordinationError != nil { throw IOSAutomationError.unavailable }
        guard let result = result else { throw IOSAutomationError.unavailable }
        return try result.get()
    }

    func snapshot() throws -> IOSAutomationState { try transaction(write: false) { $0 } }

    func setCaptureEnabled(_ enabled: Bool) throws {
        try transaction(write: true) { state in
            state.captureEnabled = enabled
            if !enabled {
                state.inputs.removeAll()
                state.lastShortcutReceivedAt = nil
            }
        }
    }

    func configure(_ configuration: IOSAutomationConfiguration) throws {
        guard configuration.ledgers.count <= Self.maxLedgers, configuration.sources.count <= Self.maxSources,
              configuration.ledgers.allSatisfy({ !$0.ledgerId.isEmpty && $0.ledgerId.count <= 200 && $0.title.count <= 200 && $0.currency.range(of: "^[A-Z]{3}$", options: .regularExpression) != nil && $0.spentMinor >= 0 && $0.spentMinor <= 9_007_199_254_740_991 && ($0.monthlyLimitMinor == nil || ($0.monthlyLimitMinor! > 0 && $0.monthlyLimitMinor! <= 9_007_199_254_740_991)) && $0.month.range(of: "^[0-9]{4}-(0[1-9]|1[0-2])$", options: .regularExpression) != nil }),
              configuration.sources.allSatisfy({ source in source.packageName.count <= 200 && configuration.ledgers.contains(where: { ledger in ledger.ledgerId == source.ledgerId }) }) else { throw IOSAutomationError.invalidInput }
        try transaction(write: true) { state in
            state.configuration = configuration
            // Revoking a scope also discards its unprocessed private text.
            state.inputs.removeAll { !Self.scopeAllows($0, configuration: configuration) }
            let ids = Set(configuration.ledgers.map(\.ledgerId))
            state.budgetMarkers = state.budgetMarkers.filter { ids.contains($0.key) }
        }
    }

    func capture(kind: String, sourceName: String, title: String? = nil, body: String? = nil,
                 amount: String? = nil, currency: String? = nil, merchant: String? = nil,
                 now: Date = Date()) throws {
        let source = Self.cleanSource(sourceName)
        guard ["notification", "message", "wallet"].contains(kind), !source.isEmpty, source.utf16.count <= 80,
              (title?.utf16.count ?? 0) <= 500, (body?.utf16.count ?? 0) <= 8_000,
              (amount?.utf16.count ?? 0) <= 80, (currency?.utf16.count ?? 0) <= 3, (merchant?.utf16.count ?? 0) <= 500,
              ![source, title ?? "", body ?? "", amount ?? "", currency ?? "", merchant ?? ""].contains(where: { $0.contains("\u{0}") }),
              now.timeIntervalSince1970.isFinite, now.timeIntervalSince1970 > 0, now.timeIntervalSince1970 < 8.64e12 else { throw IOSAutomationError.invalidInput }
        if kind == "wallet" {
            guard let amount = amount, !amount.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  let currency = currency, currency.range(of: "^[A-Z]{3}$", options: .regularExpression) != nil,
                  let merchant = merchant, !merchant.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw IOSAutomationError.invalidInput }
        } else {
            guard !((title ?? "") + (body ?? "")).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw IOSAutomationError.invalidInput }
        }
        let input = IOSShortcutInput(id: "ios-" + UUID().uuidString, queueToken: UUID().uuidString,
            kind: kind, sourceName: source, title: title, body: body,
            receivedAt: Int64(now.timeIntervalSince1970 * 1_000), amount: amount, currency: currency, merchant: merchant)
        try transaction(write: true) { state in
            guard state.captureEnabled else { throw IOSAutomationError.disabled }
            guard !state.configuration.ledgers.isEmpty else { throw IOSAutomationError.noLedger }
            guard Self.scopeAllows(input, configuration: state.configuration) else { throw IOSAutomationError.scopeDisabled }
            guard state.inputs.count < Self.maxInputs else { throw IOSAutomationError.inboxFull }
            state.inputs.append(input)
            state.lastShortcutReceivedAt = input.receivedAt
        }
        NotificationCenter.default.post(name: .walletShortcutCaptured, object: nil)
    }

    func acknowledge(_ acknowledgements: [(id: String, token: String)]) throws {
        guard acknowledgements.count <= Self.maxInputs else { throw IOSAutomationError.invalidInput }
        let keys = Set(acknowledgements.map { $0.id + "\u{0}" + $0.token })
        try transaction(write: true) { state in
            state.inputs.removeAll { keys.contains($0.id + "\u{0}" + $0.queueToken) }
        }
    }

    func markBudget(ledgerId: String, month: String, limit: Int64, level: Int) throws {
        try transaction(write: true) { state in
            state.budgetMarkers[ledgerId] = IOSBudgetMarker(month: month, limit: limit, level: level)
        }
    }

    private static func scopeAllows(_ input: IOSShortcutInput, configuration: IOSAutomationConfiguration) -> Bool {
        if input.kind == "message" { return configuration.detectSmsNotifications }
        if configuration.detectAllApps { return true }
        let source = sourceIdentifier(kind: input.kind, sourceName: input.sourceName)
        return configuration.sources.contains { $0.packageName == source }
    }

    // Kept in sync with iosTransactionInput.ts. This is an identifier, not a
    // cryptographic authentication claim about the user-configured Shortcut.
    static func sourceIdentifier(kind: String, sourceName: String) -> String {
        if kind == "wallet" { return "walletdiary.ios.wallet" }
        return "walletdiary.ios." + kind + ".s" + sourceFingerprint(sourceName)
    }

    private static func sourceFingerprint(_ value: String) -> String {
        var values: [UInt32] = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]
        for unit in cleanSource(value).lowercased(with: Locale(identifier: "en")).utf16 {
            for index in values.indices {
                values[index] = (values[index] ^ UInt32(unit)) &* (0x01000193 + UInt32(index * 2))
            }
        }
        return values.map { String(format: "%08x", $0) }.joined()
    }

    private static func cleanSource(_ value: String) -> String {
        value.precomposedStringWithCompatibilityMapping
            .replacingOccurrences(of: "[\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2060}-\u{2069}\u{FEFF}]", with: "", options: .regularExpression)
            .replacingOccurrences(of: "\r\n?", with: "\n", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

extension Notification.Name {
    static let walletShortcutCaptured = Notification.Name("WalletDiaryShortcutCaptured")
}
