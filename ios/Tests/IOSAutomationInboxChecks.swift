import Foundation

/// Host-side checks for the exact inbox compiled into the iPhone app. These
/// exercise real file I/O but neither call Shortcuts nor prove iOS background execution.
@main
struct IOSAutomationInboxChecks {
    static func require(_ condition: Bool, _ message: String) {
        precondition(condition, message)
    }

    static func expect(_ expected: IOSAutomationError, _ operation: () throws -> Void) {
        do { try operation(); preconditionFailure("Expected \(expected)") }
        catch let error as IOSAutomationError { require(error == expected, "Unexpected inbox error") }
        catch { preconditionFailure("Unexpected error type") }
    }

    static func configuration(all: Bool = true, sms: Bool = true, sources: [IOSAutomationSource] = []) -> IOSAutomationConfiguration {
        IOSAutomationConfiguration(ledgers: [IOSAutomationLedger(ledgerId: "synthetic-ledger", title: "Synthetic ledger", currency: "EUR",
            monthlyLimitMinor: 100_000, spentMinor: 0, month: "2026-11", locale: "en", automationAllApps: all, automationSmsNotifications: sms)],
            sources: sources, detectAllApps: all, detectSmsNotifications: sms)
    }

    static func configurationWithSources(_ count: Int) -> IOSAutomationConfiguration {
        let ledgerCount = max(1, (count + 499) / 500)
        let ledgers = (0..<ledgerCount).map { index in
            IOSAutomationLedger(ledgerId: "synthetic-ledger-\(index)", title: "Synthetic ledger", currency: "EUR",
                monthlyLimitMinor: nil, spentMinor: 0, month: "2026-11", locale: "en", automationAllApps: true, automationSmsNotifications: true)
        }
        let sources = (0..<count).map { index in
            IOSAutomationSource(packageName: "synthetic." + String(repeating: "a", count: 140) + ".\(index)",
                ledgerId: "synthetic-ledger-\(index / 500)", currency: "EUR")
        }
        return IOSAutomationConfiguration(ledgers: ledgers, sources: sources, detectAllApps: true, detectSmsNotifications: true)
    }

    static func main() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("wallet-inbox-check-" + UUID().uuidString, isDirectory: true)
        let inbox = IOSAutomationInbox(directory: directory)
        defer { try? FileManager.default.removeItem(at: directory) }
        let initial = try inbox.snapshot()
        require(!initial.captureEnabled && initial.inputs.isEmpty, "Capture must start disabled")
        expect(.disabled) { try inbox.capture(kind: "message", sourceName: "Synthetic Bank", body: "Paid EUR 3 at Sample Cafe") }
        try inbox.setCaptureEnabled(true)
        expect(.noLedger) { try inbox.capture(kind: "message", sourceName: "Synthetic Bank", body: "Paid EUR 3 at Sample Cafe") }
        try inbox.configure(configuration())
        try inbox.capture(kind: "notification", sourceName: "Synthetic Bank", title: "Payment completed", body: "Paid EUR 3 at Sample Cafe")
        let first = try inbox.snapshot().inputs[0]
        require(first.queueToken.count > 0 && first.receivedAt > 0 && first.kind == "notification", "Missing immutable envelope identity")
        // Persistence is shared by fresh app/intent instances, not process memory.
        let reloaded = IOSAutomationInbox(directory: directory)
        require(try reloaded.snapshot().inputs.first?.id == first.id, "Capture must survive reopening")
        try inbox.acknowledge([(first.id, "wrong-token")])
        require(try inbox.snapshot().inputs.count == 1, "Wrong token removed an input")
        try inbox.acknowledge([(first.id, first.queueToken)])
        try inbox.acknowledge([(first.id, first.queueToken)])
        require(try inbox.snapshot().inputs.isEmpty, "Acknowledgement must be idempotent")

        expect(.invalidInput) { try inbox.capture(kind: "notification", sourceName: "Bank", body: String(repeating: "💳", count: 4_001)) }
        expect(.invalidInput) { try inbox.capture(kind: "message", sourceName: "Bank", body: "EUR 3\u{0}Paid") }
        expect(.invalidInput) { try inbox.capture(kind: "wallet", sourceName: "Apple Wallet", amount: "3", currency: "EUR", merchant: "") }
        expect(.invalidInput) { try inbox.capture(kind: "wallet", sourceName: "Apple Wallet", amount: "3", currency: "€", merchant: "Sample Cafe") }
        try inbox.capture(kind: "wallet", sourceName: "Apple Wallet", amount: "3.00", currency: "EUR", merchant: "Sample Cafe")
        require(try inbox.snapshot().inputs.last?.amount == "3.00", "Native layer must preserve the exact amount string")

        try inbox.configure(configuration(all: false, sms: false))
        require(try inbox.snapshot().inputs.isEmpty, "Revoking scope must remove its queued raw text")
        expect(.scopeDisabled) { try inbox.capture(kind: "message", sourceName: "Bank", body: "Paid EUR 3 at Sample Cafe") }
        expect(.scopeDisabled) { try inbox.capture(kind: "notification", sourceName: "Bank", body: "Paid EUR 3 at Sample Cafe") }
        let source = IOSAutomationSource(packageName: IOSAutomationInbox.sourceIdentifier(kind: "notification", sourceName: "Synthetic Bank"), ledgerId: "synthetic-ledger", currency: "EUR")
        try inbox.configure(configuration(all: false, sms: false, sources: [source]))
        try inbox.capture(kind: "notification", sourceName: "Synthetic Bank", body: "Paid EUR 3 at Sample Cafe")
        try inbox.setCaptureEnabled(false)
        require(try inbox.snapshot().inputs.isEmpty, "Opt-out must delete queued raw text")
        require(try inbox.snapshot().lastShortcutReceivedAt == nil, "Opt-out must clear capture metadata")

        let vectors = [("Revolut", "400b64a86941f24e0fac06e2c122736e"), ("Example Bank", "572ba3c9daed26eb9dcdf01faf509d43"),
                       ("예시은행", "69fc879eb6908bf84849ed80e9f507d0"), ("예시은행 🍎", "7710399480b2eaa2976459e6ccf85652"),
                       (" Bank\rName ", "2aa5bf240251b0865e2e06a683eb8636")]
        for (name, hash) in vectors {
            require(IOSAutomationInbox.sourceIdentifier(kind: "notification", sourceName: name) == "walletdiary.ios.notification.s" + hash, "Source identifier differs from TypeScript")
        }
        require(IOSAutomationInbox.sourceIdentifier(kind: "wallet", sourceName: "Anything") == "walletdiary.ios.wallet", "Wallet identifier must be stable")

        // Source configuration capacity matches the shared model (50 x 500),
        // without giving raw notification text more than its original 2 MiB.
        require(IOSAutomationInbox.maxLedgers == 50 && IOSAutomationInbox.maxSources == 25_000, "Shared configuration bounds differ")
        require(IOSAutomationInbox.maxBytes == 2 * 1_024 * 1_024, "Raw-text byte limit changed")
        require(IOSAutomationInbox.maxFileBytes == 16 * 1_024 * 1_024, "Total-file byte limit differs")
        try inbox.configure(configurationWithSources(1_001))
        require(try inbox.snapshot().configuration.sources.count == 1_001, "Valid configuration above 1000 sources was rejected")
        try inbox.configure(configurationWithSources(IOSAutomationInbox.maxSources))
        let largeConfiguration = try inbox.snapshot()
        let configurationBytes = try JSONEncoder().encode(largeConfiguration).count
        require(configurationBytes > IOSAutomationInbox.maxBytes && configurationBytes < IOSAutomationInbox.maxFileBytes,
                "Fixture must exercise a configuration file above the raw-text byte limit")
        require(largeConfiguration.configuration.sources.count == IOSAutomationInbox.maxSources, "Maximum source configuration was truncated")
        expect(.invalidInput) { try inbox.configure(configurationWithSources(IOSAutomationInbox.maxSources + 1)) }
        var tooManyLedgers = configurationWithSources(1)
        tooManyLedgers.ledgers = Array(repeating: tooManyLedgers.ledgers[0], count: IOSAutomationInbox.maxLedgers + 1)
        expect(.invalidInput) { try inbox.configure(tooManyLedgers) }
        var tooManySources = configurationWithSources(1)
        tooManySources.sources = Array(repeating: tooManySources.sources[0], count: IOSAutomationInbox.maxSources + 1)
        expect(.invalidInput) { try inbox.configure(tooManySources) }

        // Simultaneous intent callbacks must not overwrite one another.
        try inbox.setCaptureEnabled(true)
        try inbox.configure(configuration())
        let failures = CheckFailures()
        DispatchQueue.concurrentPerform(iterations: 20) { index in
            do { try inbox.capture(kind: "message", sourceName: "Synthetic Bank", body: "Paid EUR \(index + 1) at Sample Cafe") }
            catch { failures.add() }
        }
        let concurrentCount = try inbox.snapshot().inputs.count
        require(failures.count == 0 && concurrentCount == 20, "Concurrent capture lost input")

        let file = directory.appendingPathComponent("inbox-v1.json")
        // Fill to the raw-byte boundary before the 1000-entry boundary. The
        // rejected append must preserve both stored bytes and last-received time.
        var byteBounded = try inbox.snapshot()
        byteBounded.inputs = []
        for index in 0..<IOSAutomationInbox.maxInputs {
            let candidate = IOSShortcutInput(id: "byte-\(index)", queueToken: "token-\(index)", kind: "message", sourceName: "Synthetic Bank", title: nil,
                body: String(repeating: "x", count: 8_000), receivedAt: 1_798_796_800_000, amount: nil, currency: nil, merchant: nil)
            let next = byteBounded.inputs + [candidate]
            if try JSONEncoder().encode(next).count > IOSAutomationInbox.maxBytes { break }
            byteBounded.inputs = next
        }
        require(byteBounded.inputs.count > 0 && byteBounded.inputs.count < IOSAutomationInbox.maxInputs, "Raw-byte fixture must hit bytes before entry count")
        let byteBoundedData = try JSONEncoder().encode(byteBounded)
        try byteBoundedData.write(to: file, options: .atomic)
        expect(.inboxFull) { try inbox.capture(kind: "message", sourceName: "Synthetic Bank", body: String(repeating: "x", count: 8_000)) }
        require(try Data(contentsOf: file) == byteBoundedData, "Raw-byte overflow modified the stored inbox")
        // Oversized raw state must also fail closed when read from disk.
        var oversizedRaw = byteBounded
        oversizedRaw.inputs.append(byteBounded.inputs[0])
        let oversizedRawData = try JSONEncoder().encode(oversizedRaw)
        try oversizedRawData.write(to: file, options: .atomic)
        expect(.unreadable) { _ = try inbox.snapshot() }
        require(try Data(contentsOf: file) == oversizedRawData, "Oversized raw state was replaced")
        try byteBoundedData.write(to: file, options: .atomic)
        var full = try inbox.snapshot()
        full.inputs = (0..<IOSAutomationInbox.maxInputs).map { index in
            IOSShortcutInput(id: "synthetic-\(index)", queueToken: "token-\(index)", kind: "message", sourceName: "Synthetic Bank", title: nil,
                body: "Paid EUR 3 at Sample Cafe", receivedAt: 1_798_796_800_000, amount: nil, currency: nil, merchant: nil)
        }
        try JSONEncoder().encode(full).write(to: file, options: .atomic)
        expect(.inboxFull) { try inbox.capture(kind: "message", sourceName: "Synthetic Bank", body: "Paid EUR 3 at Sample Cafe") }
        require(try inbox.snapshot().inputs.count == IOSAutomationInbox.maxInputs, "Full inbox must not evict old entries")
        // The total-file cap is separate and checked before decoding.
        let oversizedFile = Data(repeating: 0x20, count: IOSAutomationInbox.maxFileBytes + 1)
        try oversizedFile.write(to: file, options: .atomic)
        expect(.unreadable) { _ = try inbox.snapshot() }
        require(try Data(contentsOf: file).count == oversizedFile.count, "Oversized file was replaced")
        let corrupt = Data("not valid json".utf8)
        try corrupt.write(to: file, options: .atomic)
        expect(.unreadable) { try inbox.configure(configuration()) }
        require(try Data(contentsOf: file) == corrupt, "Corrupt data must never be replaced by empty state")
        print("PASS: iOS inbox consent, scope, persistence, token acknowledgements, bounds, source parity, concurrency and corruption checks")
    }
}

private final class CheckFailures: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0
    var count: Int { lock.lock(); defer { lock.unlock() }; return value }
    func add() { lock.lock(); value += 1; lock.unlock() }
}
