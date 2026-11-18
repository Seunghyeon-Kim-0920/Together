import Capacitor
import Foundation
import UIKit
import UserNotifications

@objc(CardAutomationPlugin)
public class CardAutomationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CardAutomationPlugin"
    public let jsName = "CardAutomation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openAccessSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAlertPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "peekPendingEvents", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "acknowledgeEvents", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recheckActiveNotifications", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setCaptureEnabled", returnType: CAPPluginReturnPromise)
    ]
    private let worker = DispatchQueue(label: "wallet.shortcut.plugin")
    private var observer: NSObjectProtocol?

    public override func load() {
        DispatchQueue.main.async { WalletBudgetNotificationDelegate.shared.install() }
        observer = NotificationCenter.default.addObserver(forName: .walletShortcutCaptured, object: nil, queue: .main) { [weak self] _ in
            self?.notifyListeners("shortcutInputsChanged", data: [:])
        }
    }
    deinit { if let observer = observer { NotificationCenter.default.removeObserver(observer) } }

    @objc func getStatus(_ call: CAPPluginCall) {
        worker.async {
            do {
                let state = try IOSAutomationInbox.shared.snapshot()
                UNUserNotificationCenter.current().getNotificationSettings { settings in
                    var supported = false
                    if #available(iOS 16.0, *) { supported = true }
                    var status: [String: Any] = [
                        "supported": supported, "captureMode": "ios-shortcuts",
                        "captureEnabled": state.captureEnabled,
                        // This is the app's consent, NOT access to arbitrary iOS notifications.
                        "accessGranted": state.captureEnabled,
                        "alertPermissionGranted": settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional,
                        "queuedInputs": state.inputs.count
                    ]
                    if let received = state.lastShortcutReceivedAt { status["lastShortcutReceivedAt"] = received }
                    call.resolve(status)
                }
            } catch { call.reject("ios-inbox-read-failed") }
        }
    }

    @objc func setCaptureEnabled(_ call: CAPPluginCall) {
        guard #available(iOS 16.0, *), let enabled = call.getBool("enabled") else { call.reject("ios-capture-unavailable"); return }
        worker.async {
            do { try IOSAutomationInbox.shared.setCaptureEnabled(enabled); call.resolve() }
            catch { call.reject("ios-capture-configuration-failed") }
        }
    }

    @objc func openAccessSettings(_ call: CAPPluginCall) {
        // Apple's documented Shortcuts URL scheme; it does not enable any automation.
        DispatchQueue.main.async {
            guard let url = URL(string: "shortcuts://") else { call.reject("shortcuts-unavailable"); return }
            UIApplication.shared.open(url, options: [:]) { opened in
                if opened { call.resolve() } else { call.reject("shortcuts-unavailable") }
            }
        }
    }

    @objc func requestAlertPermission(_ call: CAPPluginCall) {
        DispatchQueue.main.async { WalletBudgetNotificationDelegate.shared.install() }
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, error in
            if error != nil { call.reject("ios-alert-permission-failed") } else { call.resolve() }
        }
    }

    @objc func peekPendingEvents(_ call: CAPPluginCall) {
        worker.async {
            do { call.resolve(with: IOSInputBatch(inputs: try IOSAutomationInbox.shared.snapshot().inputs)) }
            catch { call.reject("ios-inbox-read-failed") }
        }
    }

    @objc func acknowledgeEvents(_ call: CAPPluginCall) {
        do {
            let batch = try call.decode(IOSAcknowledgementBatch.self)
            // A missing/old token must never remove a newer queued entry.
            let acknowledgements = batch.events.compactMap { event -> (id: String, token: String)? in
                guard let token = event.queueToken, !token.isEmpty, event.id.count <= 200, token.count <= 200 else { return nil }
                return (event.id, token)
            }
            worker.async {
                do { try IOSAutomationInbox.shared.acknowledge(acknowledgements); call.resolve() }
                catch { call.reject("ios-inbox-acknowledgement-failed") }
            }
        } catch { call.reject("ios-inbox-invalid-acknowledgement") }
    }

    @objc func configure(_ call: CAPPluginCall) {
        do {
            let configuration = try call.decode(IOSAutomationConfiguration.self)
            worker.async {
                do {
                    try IOSAutomationInbox.shared.configure(configuration)
                    Task { await IOSBudgetAlerts.shared.update() }
                    call.resolve()
                } catch { call.reject("ios-automation-configuration-failed") }
            }
        } catch { call.reject("ios-automation-invalid-configuration") }
    }

    @objc func recheckActiveNotifications(_ call: CAPPluginCall) {
        // iOS has no notification listener here. Only inspect the durable inbox.
        peekPendingEvents(call)
    }
}

private struct IOSInputBatch: Encodable { let inputs: [IOSShortcutInput] }
private struct IOSAcknowledgement: Decodable { let id: String; let queueToken: String? }
private struct IOSAcknowledgementBatch: Decodable { let events: [IOSAcknowledgement] }

/// configure() normally runs while the WebView is visible. Without this
/// delegate iOS would suppress the very budget banner that configure schedules.
/// Preserve an existing delegate's handling of all unrelated notifications.
private final class WalletBudgetNotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = WalletBudgetNotificationDelegate()
    private weak var previous: UNUserNotificationCenterDelegate?

    func install() {
        let center = UNUserNotificationCenter.current()
        guard center.delegate !== self else { return }
        previous = center.delegate
        center.delegate = self
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        if notification.request.identifier.hasPrefix("wallet-budget-") {
            completionHandler([.banner, .list, .sound])
        } else if let previous = previous,
                  previous.responds(to: #selector(UNUserNotificationCenterDelegate.userNotificationCenter(_:willPresent:withCompletionHandler:))) {
            previous.userNotificationCenter?(center, willPresent: notification, withCompletionHandler: completionHandler)
        } else { completionHandler([]) }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        if let previous = previous,
           previous.responds(to: #selector(UNUserNotificationCenterDelegate.userNotificationCenter(_:didReceive:withCompletionHandler:))) {
            previous.userNotificationCenter?(center, didReceive: response, withCompletionHandler: completionHandler)
        } else { completionHandler() }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, openSettingsFor notification: UNNotification?) {
        previous?.userNotificationCenter?(center, openSettingsFor: notification)
    }
}

/// New expense totals reach this configuration after a durable ledger save.
/// Scope reductions may configure before saving, using the remaining ledgers'
/// already-stored spending totals. Unparsed inbox amounts never contribute.
private actor IOSBudgetAlerts {
    static let shared = IOSBudgetAlerts()
    private var updating = false
    private var updateAgain = false

    func update() async {
        if updating { updateAgain = true; return }
        updating = true
        defer { updating = false }
        repeat {
            updateAgain = false
            await evaluate()
        } while updateAgain
    }

    private func evaluate() async {
        let center = UNUserNotificationCenter.current()
        let permission = await center.notificationSettings()
        guard permission.authorizationStatus == .authorized || permission.authorizationStatus == .provisional,
              let state = try? IOSAutomationInbox.shared.snapshot() else { return }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = "yyyy-MM"
        let month = formatter.string(from: Date())
        for ledger in state.configuration.ledgers where ledger.month == month {
            guard let limit = ledger.monthlyLimitMinor, limit > 0 else { continue }
            let level = ledger.spentMinor >= limit ? 100 : (Decimal(ledger.spentMinor) * 100 >= Decimal(limit) * 80 ? 80 : 0)
            guard level > 0 else { continue }
            if let marker = state.budgetMarkers[ledger.ledgerId], marker.month == month, marker.limit == limit, marker.level >= level { continue }
            let content = UNMutableNotificationContent()
            switch ledger.locale {
            case "ko":
                content.title = "지갑의 일기 · 월 예산"
                content.body = level == 100 ? "월 예산에 도달했습니다. 앱에서 소비 내역을 확인하세요." : "월 예산의 80%를 사용했습니다. 앱에서 남은 예산을 확인하세요."
            case "fr":
                content.title = "Journal du portefeuille · Budget mensuel"
                content.body = level == 100 ? "Votre budget mensuel est atteint. Consultez vos dépenses dans l’app." : "Vous avez utilisé 80 % du budget mensuel. Consultez le budget restant dans l’app."
            default:
                content.title = "Wallet Diary · Monthly budget"
                content.body = level == 100 ? "Your monthly budget has been reached. Check your spending in the app." : "You have used 80% of your monthly budget. Check the remaining budget in the app."
            }
            content.sound = .default
            let identifier = "wallet-budget-" + ledger.ledgerId + "-" + month
            do {
                try await center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
                try IOSAutomationInbox.shared.markBudget(ledgerId: ledger.ledgerId, month: month, limit: limit, level: level)
            } catch { /* Keep retryable; no financial text or system error is logged. */ }
        }
    }
}
