import { Capacitor, registerPlugin } from '@capacitor/core';

const EarySpeech = registerPlugin('EarySpeech');

let nativePermissionRequestPromise = null;
let activeNativeRecognizer = null;
let nextNativeSessionId = 1;
let lastIosNativeTranscript = '';
let lastIosNativeTranscriptAt = 0;

const normalizeLanguage = language => String(language || 'tr-TR').replace('_', '-');

const normalizeTranscriptWords = value => String(value || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

const countWordOverlap = (firstWords, secondWords) => {
    const counts = new Map();
    secondWords.forEach(word => counts.set(word, (counts.get(word) || 0) + 1));
    return firstWords.reduce((total, word) => {
        const count = counts.get(word) || 0;
        if (!count) return total;
        counts.set(word, count - 1);
        return total + 1;
    }, 0);
};

const findCachedTranscriptPrefixLength = (currentWords, previousWords) => {
    if (currentWords.length < 3 || previousWords.length < 3) return 0;
    const maxLength = Math.min(currentWords.length - 1, previousWords.length + 4);
    let bestLength = 0;
    let bestScore = 0;

    for (let length = 3; length <= maxLength; length += 1) {
        const prefixWords = currentWords.slice(0, length);
        const overlap = countWordOverlap(prefixWords, previousWords);
        const score = overlap / Math.min(length, previousWords.length);
        if (overlap >= Math.min(4, previousWords.length) && score >= 0.7 && score >= bestScore) {
            bestScore = score;
            bestLength = length;
        }
    }

    return bestLength;
};

const stripIosNativeTranscriptCarryover = (value, previousValue) => {
    const text = String(value || '').trim();
    const previousText = String(previousValue || '').trim();
    if (!text || !previousText) return text;

    const words = text.split(/\s+/).filter(Boolean);
    const currentWords = normalizeTranscriptWords(text);
    const previousWords = normalizeTranscriptWords(previousText);
    if (currentWords.length < 2 || previousWords.length < 2) return text;

    let exactPrefixLength = 0;
    const comparableLength = Math.min(currentWords.length, previousWords.length);
    for (let index = 0; index < comparableLength; index += 1) {
        if (currentWords[index] !== previousWords[index]) break;
        exactPrefixLength += 1;
    }

    const previousCoverage = exactPrefixLength / previousWords.length;
    if (exactPrefixLength >= Math.min(3, previousWords.length) && previousCoverage >= 0.7 && words.length > exactPrefixLength) {
        return words.slice(exactPrefixLength).join(' ').trim();
    }

    const fuzzyPrefixLength = findCachedTranscriptPrefixLength(currentWords, previousWords);
    if (fuzzyPrefixLength && words.length > fuzzyPrefixLength) {
        return words.slice(fuzzyPrefixLength).join(' ').trim();
    }

    return text;
};

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

const isGranted = value => String(value || '').toLowerCase() === 'granted';

const removeListener = async listener => {
    if (!listener?.remove) return;
    try {
        await listener.remove();
    } catch {
        // Native listeners are guarded by session ids; cleanup is best-effort.
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
        this.lastEmittedText = '';
        this.lastNativeText = '';
        this.sessionBaselineText = '';
        this.listeners = [];
    }

    isCurrent(sessionId) {
        return this.isListening && this.sessionId === sessionId && activeNativeRecognizer === this;
    }

    async ensurePermissions() {
        let permissions = await EarySpeech.checkPermissions();
        if (isGranted(permissions?.microphone) && isGranted(permissions?.speechRecognition ?? 'granted')) return;

        if (!nativePermissionRequestPromise) {
            nativePermissionRequestPromise = EarySpeech.requestPermissions()
                .finally(() => {
                    nativePermissionRequestPromise = null;
                });
        }

        permissions = await nativePermissionRequestPromise;
        if (!isGranted(permissions?.microphone) || !isGranted(permissions?.speechRecognition ?? 'granted')) {
            throw new Error('Mikrofon veya konuşma tanıma izni reddedildi.');
        }
    }

    async clearListeners() {
        await Promise.all(this.listeners.map(removeListener));
        this.listeners = [];
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
        this.lastEmittedText = '';
        this.lastNativeText = '';
        const shouldUseIosBaseline = Capacitor.getPlatform() === 'ios' &&
            lastIosNativeTranscript &&
            Date.now() - lastIosNativeTranscriptAt < 10 * 60 * 1000;
        this.sessionBaselineText = shouldUseIosBaseline ? lastIosNativeTranscript : '';
        const sessionId = this.sessionId;

        try {
            await this.ensurePermissions();
            await this.clearListeners();

            const partialListener = await EarySpeech.addListener('partialResults', data => {
                if (!this.isCurrent(sessionId)) return;
                const nativeText = String(data?.matches?.[0] || '').trim();
                this.lastNativeText = nativeText || this.lastNativeText;
                const isIosNativeSpeech = Capacitor.getPlatform() === 'ios';
                const text = isIosNativeSpeech
                    ? stripIosNativeTranscriptCarryover(nativeText, this.sessionBaselineText)
                    : nativeText;
                if (!text) return;
                if (text === this.lastEmittedText && data?.isFinal) return;
                this.lastEmittedText = text;

                if (data?.isFinal) {
                    this.lastInterimText = '';
                    this.onResult(text, '', data?.confidence ?? null);
                    return;
                }

                this.lastInterimText = text;
                this.onResult('', text, data?.confidence ?? null);
            });

            const stateListener = await EarySpeech.addListener('listeningState', data => {
                if (!this.isCurrent(sessionId)) return;
                if (data?.state === 'stopped') {
                    this.finish({ notifyEnd: true, callNativeStop: false });
                }
            });

            const errorListener = await EarySpeech.addListener('error', data => {
                if (!this.isCurrent(sessionId)) return;
                this.finish({ notifyEnd: false, callNativeStop: false });
                if (!isIgnorableSpeechError(data)) this.onError(data);
            });

            this.listeners = [partialListener, stateListener, errorListener];

            await EarySpeech.start({
                language: this.language,
                maxResults: 1,
                partialResults: true,
                addPunctuation: true
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
                await EarySpeech.stop();
            } catch {
                // Stop can reject if native recognition already ended.
            }
        }

        await this.clearListeners();
        this.lastInterimText = '';
        this.lastEmittedText = '';
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

export const rememberNativeSpeechTranscript = value => {
    const text = String(value || '').trim();
    if (Capacitor.getPlatform() !== 'ios' || !text) return;
    lastIosNativeTranscript = text;
    lastIosNativeTranscriptAt = Date.now();
};
