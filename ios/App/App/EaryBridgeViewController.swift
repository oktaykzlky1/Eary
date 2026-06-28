import Capacitor
import CapApp_SPM

@objc(EaryBridgeViewController)
class EaryBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(EarySpeechPlugin())
    }
}
