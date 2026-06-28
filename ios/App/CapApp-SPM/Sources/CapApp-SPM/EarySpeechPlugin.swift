import AVFoundation
import Capacitor
import Foundation
import Speech

@objc(EarySpeechPlugin)
public final class EarySpeechPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "EarySpeechPlugin"
    public let jsName = "EarySpeech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "abort", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isListening", returnType: CAPPluginReturnPromise)
    ]

    private let audioEngine = AVAudioEngine()
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var speechRecognizer: SFSpeechRecognizer?
    private var activeSessionId: Int = 0
    private var nextSessionId: Int = 1
    private var lastTranscript: String = ""
    private var hasInstalledTap = false
    private var isActive = false
    private var audioBufferCount = 0
    private var audioPeakRMS: Float = 0
    private var hasUsableAudio = false

    public override init() {
        super.init()
    }

    @objc public override func checkPermissions(_ call: CAPPluginCall) {
        call.resolve(permissionPayload())
    }

    @objc public override func requestPermissions(_ call: CAPPluginCall) {
        let group = DispatchGroup()

        group.enter()
        SFSpeechRecognizer.requestAuthorization { _ in
            group.leave()
        }

        group.enter()
        AVAudioSession.sharedInstance().requestRecordPermission { _ in
            group.leave()
        }

        group.notify(queue: .main) {
            call.resolve(self.permissionPayload())
        }
    }

    @objc func isListening(_ call: CAPPluginCall) {
        call.resolve(["listening": isActive])
    }

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.startRecognition(call)
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.finishSession(reason: "userStop", emitFinal: false)
            call.resolve()
        }
    }

    @objc func abort(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.finishSession(reason: "abort", emitFinal: false)
            call.resolve()
        }
    }

    private func startRecognition(_ call: CAPPluginCall) {
        guard microphonePermissionState() == "granted", speechPermissionState() == "granted" else {
            call.reject("Mikrofon veya konuşma tanıma izni verilmedi.")
            return
        }

        finishSession(reason: "restart", emitFinal: false)

        let language = normalizeLanguage(call.getString("language") ?? Locale.current.identifier)
        let locale = Locale(identifier: language)
        guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable else {
            call.reject("Bu dil için konuşma tanıma şu anda kullanılamıyor.")
            return
        }

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = call.getBool("partialResults") ?? true
        if #available(iOS 16.0, *) {
            request.addsPunctuation = call.getBool("addPunctuation") ?? true
        }

        let sessionId = nextSessionId
        nextSessionId += 1
        activeSessionId = sessionId
        lastTranscript = ""
        audioBufferCount = 0
        audioPeakRMS = 0
        hasUsableAudio = false
        isActive = true
        speechRecognizer = recognizer
        recognitionRequest = request

        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.record, mode: .measurement, options: [.duckOthers, .allowBluetooth])
            try audioSession.setPreferredSampleRate(44_100)
            try audioSession.setPreferredIOBufferDuration(0.02)
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

            let inputNode = audioEngine.inputNode
            if hasInstalledTap {
                inputNode.removeTap(onBus: 0)
                hasInstalledTap = false
            }

            let format = inputNode.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else {
                finishSession(reason: "audioFormatError", emitFinal: false)
                call.reject("Mikrofon ses formatı alınamadı.")
                return
            }

            inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
                guard let self, self.activeSessionId == sessionId else { return }
                self.trackAudioEnergy(buffer)
                self.recognitionRequest?.append(buffer)
            }
            hasInstalledTap = true

            recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
                guard let self else { return }
                DispatchQueue.main.async {
                    guard self.activeSessionId == sessionId else { return }

                    if let result {
                        let text = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
                        if !text.isEmpty, text != self.lastTranscript {
                            guard self.hasUsableAudio else {
                                print("[EarySpeech] Dropped speech result without usable microphone input. text=\(text) buffers=\(self.audioBufferCount) peakRMS=\(self.audioPeakRMS)")
                                return
                            }
                            self.lastTranscript = text
                            self.notifyListeners("partialResults", data: [
                                "matches": [text],
                                "isFinal": result.isFinal,
                                "sessionId": sessionId
                            ])
                        }

                        if result.isFinal {
                            self.finishSession(reason: "results", emitFinal: false)
                        }
                    }

                    if let error {
                        self.notifyListeners("error", data: [
                            "message": error.localizedDescription,
                            "sessionId": sessionId
                        ])
                        self.finishSession(reason: "error", emitFinal: false)
                    }
                }
            }

            audioEngine.prepare()
            try audioEngine.start()

            notifyListeners("listeningState", data: [
                "state": "started",
                "sessionId": sessionId
            ])
            call.resolve(["sessionId": sessionId, "state": "started"])
        } catch {
            finishSession(reason: "startError", emitFinal: false)
            call.reject(error.localizedDescription)
        }
    }

    private func finishSession(reason: String, emitFinal: Bool) {
        let sessionId = activeSessionId
        guard sessionId != 0 || isActive || audioEngine.isRunning else { return }

        if emitFinal {
            let text = lastTranscript.trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty {
                notifyListeners("partialResults", data: [
                    "matches": [text],
                    "isFinal": true,
                    "sessionId": sessionId
                ])
            }
        }

        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest = nil
        speechRecognizer = nil

        if audioEngine.isRunning {
            audioEngine.stop()
        }
        if hasInstalledTap {
            audioEngine.inputNode.removeTap(onBus: 0)
            hasInstalledTap = false
        }

        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)

        activeSessionId = 0
        lastTranscript = ""
        audioBufferCount = 0
        audioPeakRMS = 0
        hasUsableAudio = false
        isActive = false

        notifyListeners("listeningState", data: [
            "state": "stopped",
            "reason": reason,
            "sessionId": sessionId
        ])
    }

    private func permissionPayload() -> [String: String] {
        [
            "microphone": microphonePermissionState(),
            "speechRecognition": speechPermissionState()
        ]
    }

    private func microphonePermissionState() -> String {
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted:
            return "granted"
        case .denied:
            return "denied"
        case .undetermined:
            return "prompt"
        @unknown default:
            return "prompt"
        }
    }

    private func speechPermissionState() -> String {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized:
            return "granted"
        case .denied, .restricted:
            return "denied"
        case .notDetermined:
            return "prompt"
        @unknown default:
            return "prompt"
        }
    }

    private func normalizeLanguage(_ language: String) -> String {
        language.replacingOccurrences(of: "_", with: "-")
    }

    private func trackAudioEnergy(_ buffer: AVAudioPCMBuffer) {
        audioBufferCount += 1

        guard let channelData = buffer.floatChannelData else { return }
        let channelCount = Int(buffer.format.channelCount)
        let frameLength = Int(buffer.frameLength)
        guard channelCount > 0, frameLength > 0 else { return }

        var sum: Float = 0
        var sampleCount = 0

        for channel in 0..<channelCount {
            let samples = channelData[channel]
            for frame in 0..<frameLength {
                let sample = samples[frame]
                sum += sample * sample
                sampleCount += 1
            }
        }

        guard sampleCount > 0 else { return }
        let rms = sqrt(sum / Float(sampleCount))
        audioPeakRMS = max(audioPeakRMS, rms)

        if rms > 0.0015 || audioPeakRMS > 0.002 {
            hasUsableAudio = true
        }
    }
}
