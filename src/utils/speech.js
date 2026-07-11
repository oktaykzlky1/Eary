import { Capacitor, registerPlugin } from '@capacitor/core';

const EarySpeech = registerPlugin('EarySpeech');

let nativePermissionRequestPromise = null;
let activeNativeRecognizer = null;
let nextNativeSessionId = 1;
let lastIosNativeTranscript = '';
let lastIosNativeTranscriptAt = 0;

const SPEECH_LANGUAGE_ALIASES = {
    tr: 'tr-TR',
    en: 'en-US',
    de: 'de-DE',
    fr: 'fr-FR',
    es: 'es-ES',
    it: 'it-IT'
};

const normalizeLanguage = language => {
    const raw = String(language || 'tr-TR').replace('_', '-').trim();
    if (!raw) return 'tr-TR';
    const direct = Object.values(SPEECH_LANGUAGE_ALIASES).find(item => item.toLowerCase() === raw.toLowerCase());
    if (direct) return direct;
    const prefix = raw.slice(0, 2).toLowerCase();
    return SPEECH_LANGUAGE_ALIASES[prefix] || raw;
};
const WORD_CHARS = 'A-Za-z0-9\\u00C0-\\u024F\\u0100-\\u017F';
const NON_WORD_NUMBER_SPACE_RE = new RegExp(`[^${WORD_CHARS}\\s]+`, 'g');

const normalizeTranscriptWords = value => String(value || '')
    .toLocaleLowerCase('tr-TR')
    .replace(NON_WORD_NUMBER_SPACE_RE, ' ')
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
        'konuşma algılanamadı',
        'konusma algilanamadi',
        'aborted',
        'cancelled',
        'canceled',
        'userstop'
    ].some(token => value.includes(token));
};

const isFatalNativeSpeechError = error => {
    const value = toSpeechErrorText(error);
    return [
        'permission',
        'izin reddedildi',
        'denied',
        'not allowed',
        'not-allowed',
        'security',
        'locale',
        'not available',
        'unavailable',
        'kullanılamıyor',
        'kullanilamiyor'
    ].some(token => value.includes(token));
};

const isRecoverableNativeSpeechError = error => !isFatalNativeSpeechError(error);

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
    constructor(language, onResult, onEnd, onError, onDebug) {
        this.supported = true;
        this.language = normalizeLanguage(language);
        this.onResult = onResult;
        this.onEnd = onEnd;
        this.onError = onError;
        this.onDebug = typeof onDebug === 'function' ? onDebug : null;
        this.sessionId = 0;
        this.isListening = false;
        this.isEnding = false;
        this.isStarting = false;
        this.desiredListening = false;
        this.lastInterimText = '';
        this.lastEmittedText = '';
        this.lastFinalText = '';
        this.lastNativeText = '';
        this.sessionBaselineText = '';
        this.startedAt = 0;
        this.restartTimer = null;
        this.listeners = [];
    }

    debug(event, detail = {}) {
        if (!this.onDebug) return;
        this.onDebug({
            event,
            at: Date.now(),
            jsSessionId: this.sessionId,
            desiredListening: this.desiredListening,
            isListening: this.isListening,
            isStarting: this.isStarting,
            ...detail
        });
    }

    isCurrent(sessionId) {
        return (this.isListening || this.isStarting || this.desiredListening) &&
            this.sessionId === sessionId &&
            activeNativeRecognizer === this;
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

    clearRestartTimer() {
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
    }

    emitFinalInterim() {
        const text = this.lastInterimText.trim();
        if (!text || text === this.lastFinalText) return;
        this.debug('jsEmitFinalInterim', { textLength: text.length });
        this.lastFinalText = text;
        this.lastInterimText = '';
        this.onResult(text, '', null);
    }

    scheduleRestart(delay = null) {
        if (!this.desiredListening || this.restartTimer || this.isEnding) return;
        this.isListening = false;
        this.isStarting = false;
        this.emitFinalInterim();

        const elapsed = Date.now() - this.startedAt;
        const graceDelay = Math.max(0, 450 - elapsed);
        const restartDelay = delay ?? Math.max(180, graceDelay);
        this.debug('jsScheduleRestart', { delayMs: restartDelay, elapsedMs: elapsed });
        this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            if (!this.desiredListening || this.isEnding) return;
            this.startNativeSession({ preserveText: true }).catch(error => {
                if (this.desiredListening && isRecoverableNativeSpeechError(error)) {
                    this.scheduleRestart(320);
                    return;
                }
                this.desiredListening = false;
                this.finish({ notifyEnd: true, callNativeStop: true }).finally(() => this.onError(error));
            });
        }, restartDelay);
    }

    async addNativeListeners(sessionId) {
        if (this.listeners.length) return;

        const partialListener = await EarySpeech.addListener('partialResults', data => {
            if (!this.isCurrent(sessionId)) return;
            const nativeText = String(data?.matches?.[0] || '').trim();
            this.debug(data?.isFinal ? 'jsFinalReceived' : 'jsPartialReceived', {
                nativeSessionId: data?.sessionId,
                textLength: nativeText.length,
                confidence: data?.confidence ?? null
            });
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
                this.lastFinalText = text;
                this.onResult(text, '', data?.confidence ?? null);
                return;
            }

            this.lastInterimText = text;
            this.onResult('', text, data?.confidence ?? null);
        });

        const stateListener = await EarySpeech.addListener('listeningState', data => {
            if (!this.isCurrent(sessionId)) return;
            this.debug('jsState', { nativeSessionId: data?.sessionId, state: data?.state, reason: data?.reason || null });
            if (data?.state === 'started') {
                this.isStarting = false;
                this.isListening = true;
                return;
            }
            if (data?.state === 'stopped') {
                if (this.desiredListening) {
                    this.scheduleRestart();
                    return;
                }
                this.finish({ notifyEnd: true, callNativeStop: false });
            }
        });

        const errorListener = await EarySpeech.addListener('error', data => {
            if (!this.isCurrent(sessionId)) return;
            this.debug('jsError', { nativeSessionId: data?.sessionId, code: data?.code, message: data?.message });
            const recoverable = isRecoverableNativeSpeechError(data);
            if (this.desiredListening && recoverable) {
                this.scheduleRestart();
                return;
            }
            this.finish({ notifyEnd: recoverable || isIgnorableSpeechError(data), callNativeStop: false });
            if (!isIgnorableSpeechError(data)) this.onError(data);
        });

        this.listeners = [partialListener, stateListener, errorListener];
    }

    async startNativeSession({ preserveText = false } = {}) {
        if (!this.desiredListening || this.isStarting || this.isListening) return;

        if (activeNativeRecognizer && activeNativeRecognizer !== this) {
            await activeNativeRecognizer.abort();
        }

        activeNativeRecognizer = this;
        if (!this.sessionId) {
            this.sessionId = nextNativeSessionId;
            nextNativeSessionId += 1;
        }
        this.isListening = true;
        this.isStarting = true;
        this.isEnding = false;
        this.startedAt = Date.now();
        this.debug('jsStartNativeSession', { preserveText });
        if (!preserveText) {
            this.lastInterimText = '';
            this.lastEmittedText = '';
            this.lastFinalText = '';
            this.lastNativeText = '';
        }
        const shouldUseIosBaseline = Capacitor.getPlatform() === 'ios' &&
            lastIosNativeTranscript &&
            Date.now() - lastIosNativeTranscriptAt < 10 * 60 * 1000;
        this.sessionBaselineText = shouldUseIosBaseline ? lastIosNativeTranscript : '';
        const sessionId = this.sessionId;

        await this.ensurePermissions();
        await this.addNativeListeners(sessionId);

        try {
            this.debug('jsNativeStartCall', { language: this.language });
            await EarySpeech.start({
                language: this.language,
                maxResults: 5,
                partialResults: true,
                addPunctuation: false,
                continuous: true,
                debug: false
            });
            this.debug('jsNativeStartResolved');
            this.isStarting = false;
        } catch (error) {
            this.debug('jsNativeStartRejected', { message: error?.message || String(error || '') });
            this.isStarting = false;
            this.isListening = false;
            if (this.desiredListening && isRecoverableNativeSpeechError(error)) {
                this.scheduleRestart(320);
                return;
            }
            throw error;
        }
    }

    async start() {
        if (this.desiredListening || this.isStarting || this.isListening) return;

        if (activeNativeRecognizer && activeNativeRecognizer !== this) {
            await activeNativeRecognizer.abort();
        }

        activeNativeRecognizer = this;
        this.sessionId = nextNativeSessionId;
        nextNativeSessionId += 1;
        this.lastInterimText = '';
        this.lastEmittedText = '';
        this.lastFinalText = '';
        this.lastNativeText = '';
        this.desiredListening = true;
        this.clearRestartTimer();
        this.debug('jsStart');

        try {
            await this.clearListeners();
            await this.startNativeSession();
        } catch (error) {
            this.desiredListening = false;
            await this.finish({ notifyEnd: false, callNativeStop: true });
            throw error;
        }
    }

    async finish({ notifyEnd, callNativeStop }) {
        if (this.isEnding) return;
        this.isEnding = true;
        const wasListening = this.isListening || this.isStarting || this.desiredListening;
        this.clearRestartTimer();
        this.desiredListening = false;
        this.isListening = false;
        this.isStarting = false;
        this.sessionId = 0;
        this.debug('jsFinish', { notifyEnd, callNativeStop, wasListening });

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
        this.lastFinalText = '';
        this.isEnding = false;

        if (wasListening && notifyEnd) this.onEnd();
    }

    async stop() {
        if (!this.isListening && !this.isStarting && !this.desiredListening) return;
        this.emitFinalInterim();
        await this.finish({ notifyEnd: true, callNativeStop: true });
    }

    async abort() {
        if (!this.isListening && !this.isStarting && !this.desiredListening && !this.listeners.length) return;
        await this.finish({ notifyEnd: false, callNativeStop: true });
    }

    async restart() {
        if (!this.desiredListening) {
            await this.start();
            return;
        }
        this.clearRestartTimer();
        try {
            await EarySpeech.abort?.();
        } catch {
            // Native may already be between sessions.
        }
        this.isListening = false;
        this.isStarting = false;
        this.scheduleRestart(220);
    }
}

export const getDuoSpeechRecognizer = (language, onResult, onEnd, onError, onDebug = null) => {
    if (Capacitor.isNativePlatform()) {
        return new NativeSpeechRecognizer(language, onResult, onEnd, onError, onDebug);
    }
    return new WebSpeechRecognizer(language, onResult, onEnd, onError);
};

export const rememberNativeSpeechTranscript = value => {
    const text = String(value || '').trim();
    if (Capacitor.getPlatform() !== 'ios' || !text) return;
    lastIosNativeTranscript = text;
    lastIosNativeTranscriptAt = Date.now();
};
