import AppIntents
import Foundation

/// The user explicitly adds these actions to selected personal automations.
/// They do not request SMS history, scan other apps or create automations silently.
@available(iOS 16.0, *)
struct CaptureBankNotificationIntent: AppIntent {
    static var title: LocalizedStringResource = "Capture bank notification"
    static var description = IntentDescription("Save selected notification text locally for processing when Wallet Diary opens. This is not confirmation of a completed payment.")
    static var openAppWhenRun = false
    static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
    @Parameter(title: "Bank or card app") var sourceName: String
    @Parameter(title: "Notification title") var notificationTitle: String?
    @Parameter(title: "Notification text") var body: String

    func perform() async throws -> some IntentResult {
        try IOSAutomationInbox.shared.capture(kind: "notification", sourceName: sourceName, title: notificationTitle, body: body)
        return .result()
    }
}

@available(iOS 16.0, *)
struct CaptureBankMessageIntent: AppIntent {
    static var title: LocalizedStringResource = "Capture bank message"
    static var description = IntentDescription("Save a selected bank message locally for processing when Wallet Diary opens. Never connect personal messages or verification codes.")
    static var openAppWhenRun = false
    static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
    @Parameter(title: "Bank or sender") var sourceName: String
    @Parameter(title: "Message text") var body: String

    func perform() async throws -> some IntentResult {
        try IOSAutomationInbox.shared.capture(kind: "message", sourceName: sourceName, body: body)
        return .result()
    }
}

@available(iOS 16.0, *)
struct CaptureWalletTransactionIntent: AppIntent {
    static var title: LocalizedStringResource = "Capture Wallet transaction"
    static var description = IntentDescription("Save the amount, currency and merchant supplied by a Wallet transaction automation. Process it when Wallet Diary opens.")
    static var openAppWhenRun = false
    static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
    @Parameter(title: "Amount") var amount: String
    @Parameter(title: "Currency code") var currency: String
    @Parameter(title: "Merchant") var merchant: String

    func perform() async throws -> some IntentResult {
        try IOSAutomationInbox.shared.capture(kind: "wallet", sourceName: "Apple Wallet", amount: amount,
            currency: currency.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(), merchant: merchant)
        return .result()
    }
}
