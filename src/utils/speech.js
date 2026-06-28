import { Capacitor, registerPlugin } from '@capacitor/core';
import { SpeechRecognition } from '@capgo/capacitor-speech-recognition';

const VoiceSettings = registerPlugin('VoiceSettings');
let nativePermissionRequestPromise = null;

const isIOSNative = () => Capacitor.getPlatform() === 'ios';

const nativeSpeechErrorText = error => {
    try {
        return [error?.message, error?.error, JSON.stringify(error), String(error || '')]
            .filter(Boolean).join(' ').toLowerCase();
    } catch {
        return String(error || '').toLowerCase();
    }
};

const isRecoverableNativeSpeechError = error => {
    const value = nativeSpeechErrorText(error);
    const fatal = ['permission', 'izin reddedildi', 'not authorized', 'language pack', 'locale'];
    if (fatal.some(token => value.includes(token))) return false;
    if (Capacitor.getPlatform() === 'ios') return true;
    return ['no match', 'no_match', 'no speech', 'no_speech', 'busy', 'already', 'cancelled', 'canceled']
        .some(token => value.includes(token));
};

class WebSpeechRecognizer {
    constructor(language, onResult, onEnd, onError) {
        const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognitionClass) {
            this.supported = false;
            return;
        }
        this.supported = true;
        this.isListening = false;
        this.recognition = new SpeechRecognitionClass();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = language;

        this.recognition.onresult = (event) => {
            let finalTranscript = '';
            let interimTranscript = '';
            let finalConfidence = null;
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                    finalConfidence = event.results[i][0].confidence;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }
            onResult(finalTranscript, interimTranscript, finalConfidence);
        };

        this.recognition.onend = () => {
            if (this.isListening) {
                try {
                    this.recognition.start();
                } catch (e) {
                    console.error("WebSpeech auto-restart error:", e);
                }
            } else {
                onEnd();
            }
        };

        this.recognition.onerror = (err) => {
            onError(err);
        };
    }

    start() {
        if (!this.supported) return;
        this.isListening = true;
        this.recognition.start();
    }

    stop() {
        if (!this.supported) return;
        this.isListening = false;
        this.recognition.stop();
    }

    abort() {
        if (!this.supported) return;
        this.isListening = false;
        this.recognition.abort();
    }

    restart() {
        if (!this.supported) return;
        try {
            this.recognition.abort();
        } catch (e) {
            console.error("WebSpeech restart error:", e);
        }
    }
}

class NativeSpeechRecognizer {
    constructor(language, onResult, onEnd, onError) {
        this.supported = true;
        this.language = language;
        this.onResult = onResult;
        this.onEnd = onEnd;
        this.onError = onError;
        this.listener = null;
        this.stateListener = null;
        this.errorListener = null;
        this.isListening = false;
        this.lastPartialText = '';
        this.isStartingOrRestarting = false;
        this.restartTimer = null;
        this.startedAt = 0;
        this.useOnDeviceRecognition = false;
    }

    async start() {
        if (this.isListening || this.isStartingOrRestarting) return;
        try {
            if (!isIOSNative()) {
                try {
                    await VoiceSettings.startAudioRouting();
                } catch (e) {
                    console.error("Failed to start audio routing:", e);
                }
            }

            // 1. Verify and request Android native microphone permissions
            let permStatus = await SpeechRecognition.checkPermissions();
            if (permStatus.speechRecognition !== 'granted') {
                if (!nativePermissionRequestPromise) {
                    nativePermissionRequestPromise = SpeechRecognition.requestPermissions()
                        .finally(() => { nativePermissionRequestPromise = null; });
                }
                permStatus = await nativePermissionRequestPromise;
                if (permStatus.speechRecognition !== 'granted') {
                    this.onError("Mikrofon veya konuşma tanıma izni reddedildi.");
                    return;
                }
            }

            this.isListening = true;
            this.lastPartialText = '';
            this.isStartingOrRestarting = true;
            this.startedAt = Date.now();

            await this.removeListeners();

            // 2. Register listener for native partial transcription updates
            this.listener = await SpeechRecognition.addListener("partialResults", (data) => {
                if (data && data.matches && data.matches.length > 0) {
                    const text = data.matches[0];
                    this.lastPartialText = text;
                    // Treat matches[0] as interim preview text
                    this.onResult("", text);
                }
            });

            // 3. Register state listener to detect if the OS stops listening (e.g. silence or error)
            this.stateListener = await SpeechRecognition.addListener("listeningState", (data) => {
                if (data && data.state === "started") {
                    this.isStartingOrRestarting = false;
                }
                if (data && data.state === "stopped" && this.isListening) {
                    if (isIOSNative()) {
                        this.isListening = false;
                        this.isStartingOrRestarting = false;
                        this.onEnd();
                        return;
                    }
                    this.scheduleRestart();
                }
            });

            // Register error listener
            this.errorListener = await SpeechRecognition.addListener("error", (data) => {
                console.error("Native SpeechRecognition Error Event:", data);
                if (this.isListening) {
                    const errorMsg = data.message || data.error || "";
                    if (isIOSNative()) {
                        this.isListening = false;
                        this.isStartingOrRestarting = false;
                        this.onError(errorMsg || "Speech Recognition Error");
                        return;
                    }
                    if (isRecoverableNativeSpeechError(data)) {
                        this.scheduleRestart();
                        return;
                    }
                    this.onError(errorMsg || "Speech Recognition Error");
                    this.stop();
                }
            });

            let useOnDeviceRecognition = false;
            if (!isIOSNative()) {
                try {
                    const availability = await SpeechRecognition.isOnDeviceRecognitionAvailable({ language: this.language });
                useOnDeviceRecognition = Boolean(availability?.available);
                this.useOnDeviceRecognition = useOnDeviceRecognition;
                } catch (error) {
                    console.warn('On-device speech recognition availability could not be checked:', error);
                }
            }

            if (!isIOSNative()) {
                await SpeechRecognition.setPTTState({ held: true });
            }

            // 4. Launch native speech recognizer silently in the background (no popup)
            await SpeechRecognition.start({
                language: this.language,
                maxResults: 1,
                partialResults: true,
                popup: false,
                addPunctuation: true,
                allowForSilence: 3000,
                continuousPTT: !isIOSNative(),
                useOnDeviceRecognition
            });

        } catch (err) {
            this.isStartingOrRestarting = false;
            if (this.isListening) {
                if (isIOSNative()) {
                    this.isListening = false;
                    this.onError(err);
                    return;
                }
                if (isRecoverableNativeSpeechError(err)) {
                    this.scheduleRestart();
                    return;
                }
                this.isListening = false;
                this.onError(err);
            }
        }
    }

    scheduleRestart() {
        if (!this.isListening || this.restartTimer) return;
        const remainingGracePeriod = Math.max(0, 1200 - (Date.now() - this.startedAt));
        this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            this.restartListening();
        }, Math.max(250, remainingGracePeriod));
    }

    async restartListening() {
        if (!this.isListening) return;
        if (isIOSNative()) return;
        if (this.isStartingOrRestarting) {
            console.log("Speech recognition is already starting/restarting, skipping redundant restart call.");
            return;
        }
        this.isStartingOrRestarting = true;
        this.startedAt = Date.now();
        try {
            try {
                await VoiceSettings.startAudioRouting();
            } catch (errRoute) {
                console.error("Failed to start audio routing on restart:", errRoute);
            }

            // Finalize the last partial text if any
            if (this.lastPartialText.trim()) {
                this.onResult(this.lastPartialText.trim(), "");
                this.lastPartialText = '';
            }
            
            // Restart native Speech Recognition silently
            await SpeechRecognition.start({
                language: this.language,
                maxResults: 1,
                partialResults: true,
                popup: false,
                addPunctuation: true,
                allowForSilence: 3000,
                continuousPTT: true,
                useOnDeviceRecognition: this.useOnDeviceRecognition
            });
        } catch (e) {
            console.error("Error restarting speech recognition:", e);
            this.isStartingOrRestarting = false;
            if (isRecoverableNativeSpeechError(e)) this.scheduleRestart();
            else this.stop();
        }
    }

    async stop() {
        if (!this.isListening) return;
        this.isListening = false;
        this.isStartingOrRestarting = false;
        clearTimeout(this.restartTimer);
        this.restartTimer = null;
        
        try {
            if (isIOSNative()) {
                const result = await SpeechRecognition.stop();
                const finalText = String(result?.matches?.[0] || this.lastPartialText || '').trim();
                if (finalText) this.onResult(finalText, "");
            } else {
                await SpeechRecognition.setPTTState({ held: false });
                const cached = await SpeechRecognition.getLastPartialResult();
                await SpeechRecognition.forceStop({ timeout: 1000 });
                const finalText = String(cached?.text || this.lastPartialText || '').trim();
                if (finalText) this.onResult(finalText, "");
            }
        } catch (e) {
            console.error("Error stopping Speech Recognition:", e);
            if (this.lastPartialText.trim()) {
                this.onResult(this.lastPartialText.trim(), "");
            }
        }

        if (!isIOSNative()) {
            try {
                await VoiceSettings.stopAudioRouting();
            } catch (e) {
                console.error("Failed to stop audio routing:", e);
            }
        }

        await this.removeListeners();

        // Instantly trigger UI reset to turn button grey
        this.onEnd();
    }

    async removeListeners() {
        if (this.listener) {
            try {
                this.listener.remove();
            } catch (error) {
                console.warn("Failed to remove speech partial listener:", error);
            }
            this.listener = null;
        }
        if (this.stateListener) {
            try {
                this.stateListener.remove();
            } catch (error) {
                console.warn("Failed to remove speech state listener:", error);
            }
            this.stateListener = null;
        }
        if (this.errorListener) {
            try {
                this.errorListener.remove();
            } catch (error) {
                console.warn("Failed to remove speech error listener:", error);
            }
            this.errorListener = null;
        }
    }

    abort() {
        this.stop();
    }

    restart() {
        this.lastPartialText = '';
        this.restartListening();
    }
}

export const getDuoSpeechRecognizer = (language, onResult, onEnd, onError) => {
    if (Capacitor.isNativePlatform()) {
        return new NativeSpeechRecognizer(language, onResult, onEnd, onError);
    } else {
        return new WebSpeechRecognizer(language, onResult, onEnd, onError);
    }
};
