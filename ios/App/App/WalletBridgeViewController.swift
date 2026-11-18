import Capacitor

final class WalletBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(CardAutomationPlugin())
        bridge?.registerPluginInstance(DocumentFilesPlugin())
    }
}
