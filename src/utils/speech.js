import { Capacitor } from '@capacitor/core';
import { SpeechRecognition } from '@capgo/capacitor-speech-recognition';

let nativePermissionRequestPromise = null;
let activeNativeRecognizer = null;
let nextNativeSessionId = 1;

const normalizeLanguage = language => String(language || 'tr-TR').replace('_', '-');

const toSpeechErrorText = error => {
    try {
        return [error?.message, error?.error, error?.code, JSON.stringify(error), String(error || '')]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
    } catch {
        return String(error || '').toLowerCase();
    }
};

const isIgnorableSpeechError = error => {
    const value = toSpeechErrorText(error);
    return [
        'no match',
        'no_match',
        'no speech',
        'no_speech',
        'aborted',
        'cancelled',
        'canceled',
        'userstop'
    ].some(token => value.includes(token));
};

const removeListener = async listener => {
    if (!listener?.remove) return;
    try {
        await listener.remove();
    } catch {
        // Listener cleanup is best-effort; stale callbacks are also guarded by sessionId.
    }
};

class WebSpeechRecognizer {
    constructor(language, onResult, onEnd, onError) {
        const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognitionClass) {
            this.supported = false;
            return;
        }

        this.supported = true;
        this.language = normalizeLanguage(language);
        this.onResult = onResult;
        this.onEnd = onEnd;
        this.onError = onError;
        this.isListening = false;
        this.recognition = new SpeechRecognitionClass();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = this.language;

        this.recognition.onresult = event => {
            let finalTranscript = '';
            let interimTranscript = '';
            let finalConfidence = null;

            for (let index = event.resultIndex; index < event.results.length; index += 1) {
                const result = event.results[index];
                const transcript = result?.[0]?.transcript || '';
                if (result.isFinal) {
                    finalTranscript += transcript;
                    finalConfidence = result?.[0]?.confidence ?? null;
                } else {
                    interimTranscript += transcript;
                }
            }

            this.onResult(finalTranscript.trim(), interimTranscript.trim(), finalConfidence);
        };

        this.recognition.onend = () => {
            if (this.isListening) {
                try {
                    this.recognition.start();
                } catch {
                    this.isListening = false;
                    this.onEnd();
                }
                return;
            }
            this.onEnd();
        };

        this.recognition.onerror = error => {
            if (isIgnorableSpeechError(error)) return;
            this.onError(error);
        };
    }

    start() {
        if (!this.supported || this.isListening) return;
        this.isListening = true;
        this.recognition.lang = this.language;
        this.recognition.start();
    }

    stop() {
        if (!this.supported || !this.isListening) return;
        this.isListening = false;
        this.recognition.stop();
    }

    abort() {
        if (!this.supported) return;
        this.isListening = false;
        this.recognition.abort();
    }

    restart() {
        this.abort();
        this.start();
    }
}

class NativeSpeechRecognizer {
    constructor(language, onResult, onEnd, onError) {
        this.supported = true;
        this.language = normalizeLanguage(language);
        this.onResult = onResult;
        this.onEnd = onEnd;
        this.onError = onError;
        this.sessionId = 0;
        this.isListening = false;
        this.isEnding = false;
        this.lastInterimText = '';
        this.listeners = [];
    }

    isCurrent(sessionId) {
        return this.isListening && this.sessionId === sessionId && activeNativeRecognizer === this;
    }

    async ensurePermissions() {
        let permissions = await SpeechRecognition.checkPermissions();
        if (permissions?.speechRecognition === 'granted') return;

        if (!nativePermissionRequestPromise) {
            nativePermissionRequestPromise = SpeechRecognition.requestPermissions()
                .finally(() => {
                    nativePermissionRequestPromise = null;
                });
        }

        permissions = await nativePermissionRequestPromise;
        if (permissions?.speechRecognition !== 'granted') {
            throw new Error('Mikrofon veya konuşma tanıma izni reddedildi.');
        }
    }

    async clearPluginListeners() {
        await Promise.all(this.listeners.map(removeListener));
        this.listeners = [];
        try {
            await SpeechRecognition.removeAllListeners?.();
        } catch {
            // Older plugin versions may not expose removeAllListeners.
        }
    }

    async start() {
        if (this.isListening) return;

        if (activeNativeRecognizer && activeNativeRecognizer !== this) {
            await activeNativeRecognizer.abort();
        }

        activeNativeRecognizer = this;
        this.sessionId = nextNativeSessionId;
        nextNativeSessionId += 1;
        this.isListening = true;
        this.isEnding = false;
        this.lastInterimText = '';
        const sessionId = this.sessionId;

        try {
            await this.ensurePermissions();
            await this.clearPluginListeners();

            const partialListener = await SpeechRecognition.addListener('partialResults', data => {
                if (!this.isCurrent(sessionId)) return;
                const text = String(data?.matches?.[0] || '').trim();
                if (!text) return;

                this.lastInterimText = text;
                this.onResult('', text, null);
            });

            const stateListener = await SpeechRecognition.addListener('listeningState', data => {
                if (!this.isCurrent(sessionId)) return;
                if (data?.state === 'stopped') {
                    this.finish({ notifyEnd: true, callNativeStop: false });
                }
            });

            const errorListener = await SpeechRecognition.addListener('error', data => {
                if (!this.isCurrent(sessionId)) return;
                this.finish({ notifyEnd: false, callNativeStop: false });
                if (!isIgnorableSpeechError(data)) this.onError(data);
            });

            this.listeners = [partialListener, stateListener, errorListener];

            await SpeechRecognition.start({
                language: this.language,
                maxResults: 1,
                partialResults: true,
                popup: false,
                addPunctuation: true,
                allowForSilence: 3000,
                continuousPTT: false,
                useOnDeviceRecognition: false
            });
        } catch (error) {
            await this.finish({ notifyEnd: false, callNativeStop: true });
            throw error;
        }
    }

    async finish({ notifyEnd, callNativeStop }) {
        if (this.isEnding) return;
        this.isEnding = true;
        const wasListening = this.isListening;
        this.isListening = false;
        this.sessionId = 0;

        if (activeNativeRecognizer === this) activeNativeRecognizer = null;

        if (callNativeStop) {
            try {
                await SpeechRecognition.stop();
            } catch {
                // Stop can reject if native recognition already ended.
            }
        }

        await this.clearPluginListeners();
        this.lastInterimText = '';
        this.isEnding = false;

        if (wasListening && notifyEnd) this.onEnd();
    }

    async stop() {
        if (!this.isListening) return;
        await this.finish({ notifyEnd: true, callNativeStop: true });
    }

    async abort() {
        if (!this.isListening && !this.listeners.length) return;
        await this.finish({ notifyEnd: false, callNativeStop: true });
    }

    async restart() {
        await this.abort();
        await this.start();
    }
}

export const getDuoSpeechRecognizer = (language, onResult, onEnd, onError) => {
    if (Capacitor.isNativePlatform()) {
        return new NativeSpeechRecognizer(language, onResult, onEnd, onError);
    }
    return new WebSpeechRecognizer(language, onResult, onEnd, onError);
};
