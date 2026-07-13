import { useEffect, useRef, useState } from 'react';
import {
    ArrowLeft, Captions,
    Check, ChevronRight, ContactRound, FileText,
    History, Languages, MessageCircle, Mic, PanelsTopLeft, Phone, Save, ShieldAlert,
    Share2, Sparkles, StopCircle, UserRound, Volume2, X
} from 'lucide-react';
import { getDuoSpeechRecognizer } from '../utils/speech';
import { correctTranscription, extractPersonalTerms } from '../utils/autocorrect';
import { SUPPORTED_LANGUAGES, getInitialAppLanguage, getLanguageLabel, normalizeAppLanguage } from '../utils/language';
import { uiText } from '../utils/i18n';
import { Capacitor, registerPlugin } from '@capacitor/core';

const VoiceSettings = registerPlugin('VoiceSettings');
const MAX_FACE_MESSAGE_CHARS = 700;
const limitFaceMessageText = text => String(text || '').trim().slice(0, MAX_FACE_MESSAGE_CHARS).trim();

const MODE_CONFIG = {
    general: {
        title: 'Genel', icon: Captions, color: '#176b5b', prompt: 'Konuşmayı okunabilir canlı metne çevir',
        speakers: ['Konuşmacı'],
        phrases: ['Tekrar eder misiniz?', 'Biraz yavaş konuşabilir misiniz?', 'Bunu yazılı olarak paylaşır mısınız?']
    },
    lesson: {
        title: 'Ders', icon: Captions, color: '#176b5b', prompt: 'Ders anlatımını canlı metne çevir',
        speakers: ['Öğretmen'],
        phrases: ['Tekrar eder misiniz?', 'Biraz yavaş anlatır mısınız?', 'Bunu yazılı olarak paylaşır mısınız?']
    },
    meeting: {
        title: 'Toplantı', icon: Captions, color: '#176b5b', prompt: 'Toplantı notlarını canlı metne çevir',
        speakers: ['Konuşmacı'],
        phrases: ['Tekrar eder misiniz?', 'Aksiyon maddesini netleştirir misiniz?', 'Bunu yazılı paylaşır mısınız?']
    },
    conference: {
        title: 'Konferans', icon: Captions, color: '#176b5b', prompt: 'Konferans konuşmasını canlı metne çevir',
        speakers: ['Konuşmacı'],
        phrases: ['Tekrar eder misiniz?', 'Biraz daha yavaş konuşur musunuz?', 'Kaynakları paylaşır mısınız?']
    }
};

const WORD_CHARS = 'A-Za-z0-9\\u00C0-\\u024F\\u0100-\\u017F';
const DUPLICATE_WORD_RE = new RegExp(`\\b([${WORD_CHARS}]{2,})\\s+\\1\\b`, 'gi');
const NON_WORD_NUMBER_SPACE_RE = new RegExp(`[^${WORD_CHARS}\\s]+`, 'g');

const LISTENING_REPLACEMENTS = [
    [/\bprose\b/giu, 'proje'],
    [/\bproje teslim tarihihi\b/giu, 'proje teslim tarihini'],
    [/\byollican\b/giu, 'göndereceksiniz'],
    [/\byollayacaksınız\b/giu, 'göndereceksiniz'],
    [/\bpdf\b/giu, 'PDF'],
    [/\bquiz\b/giu, 'quiz'],
    [/\brandevu\b/giu, 'randevu'],
    [/\btahlil\b/giu, 'tahlil']
];

const cleanListeningText = (text, language = 'tr-TR', options = {}) => {
    let next = correctTranscription(String(text || ''), language, options)
        .replace(/\s+/g, ' ')
        .replace(DUPLICATE_WORD_RE, '$1')
        .trim();
    LISTENING_REPLACEMENTS.forEach(([pattern, replacement]) => {
        next = next.replace(pattern, replacement);
    });
    next = next.replace(/\s+([.,!?])/g, '$1');
    return next;
};

const cleanLiveSpeechText = text => String(text || '')
    .replace(/\s+/g, ' ')
    .replace(DUPLICATE_WORD_RE, '$1')
    .trim();

const stripLivePunctuation = text => String(text || '')
    .replace(/[.,!?;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const cleanLiveDictationText = (text, language = null, options = {}) => {
    const raw = language
        ? correctTranscription(text, language, { ...options, live: true, finalize: false })
        : String(text || '');
    return cleanLiveSpeechText(stripLivePunctuation(raw));
};

const buildSpeechPersonalTerms = account => extractPersonalTerms(
    account?.nickname,
    account?.username,
    account?.profile?.nickname,
    account?.profile?.bio
);

const normalizeTranscriptForMerge = text => String(text || '')
    .toLocaleLowerCase('tr-TR')
    .replace(NON_WORD_NUMBER_SPACE_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const mergeLiveTranscript = (previousText, nextText) => {
    const previous = cleanLiveSpeechText(previousText);
    const next = cleanLiveSpeechText(nextText);
    if (!previous) return next;
    if (!next) return previous;
    const previousKey = normalizeTranscriptForMerge(previous);
    const nextKey = normalizeTranscriptForMerge(next);
    if (!previousKey) return next;
    if (!nextKey) return previous;
    if (previousKey === nextKey) return previous;
    if (nextKey.startsWith(`${previousKey} `)) return next;
    if (previousKey.endsWith(` ${nextKey}`) || previousKey.includes(` ${nextKey} `)) return previous;
    const previousWords = previous.split(/\s+/);
    const nextWords = next.split(/\s+/);
    const previousCompareWords = normalizeTranscriptForMerge(previous).split(/\s+/).filter(Boolean);
    const nextCompareWords = normalizeTranscriptForMerge(next).split(/\s+/).filter(Boolean);
    const maxOverlap = Math.min(previousCompareWords.length, nextCompareWords.length, 24);
    for (let size = maxOverlap; size >= 2; size -= 1) {
        const previousTail = previousCompareWords.slice(-size).join(' ');
        const nextHead = nextCompareWords.slice(0, size).join(' ');
        if (previousTail === nextHead) return [...previousWords, ...nextWords.slice(size)].join(' ').trim();
    }
    return `${previous} ${next}`.trim();
};

const splitWords = value => String(value || '').trim().split(/\s+/).filter(Boolean);

const splitHeadTail = (text, keepWords = 120) => {
    const words = splitWords(text);
    if (words.length <= keepWords) return { head: '', tail: words.join(' ') };
    return {
        head: words.slice(0, -keepWords).join(' '),
        tail: words.slice(-keepWords).join(' ')
    };
};

const mergeLongLiveTranscript = (baseText, incomingText, keepWords = 120) => {
    const base = cleanLiveSpeechText(baseText);
    const incoming = cleanLiveSpeechText(incomingText);
    if (!base) return incoming;
    if (!incoming) return base;
    const { head, tail } = splitHeadTail(base, keepWords);
    const mergedTail = mergeLiveTranscript(tail, incoming);
    return [head, mergedTail].filter(Boolean).join(' ').trim();
};

const countWordMatches = (leftWords, rightWords) => {
    const counts = new Map();
    rightWords.forEach(word => counts.set(word, (counts.get(word) || 0) + 1));
    return leftWords.reduce((total, word) => {
        const count = counts.get(word) || 0;
        if (!count) return total;
        counts.set(word, count - 1);
        return total + 1;
    }, 0);
};

const isLikelySpeechRevision = (previousText, incomingText) => {
    const previousWords = normalizeTranscriptForMerge(previousText).split(/\s+/).filter(Boolean);
    const incomingWords = normalizeTranscriptForMerge(incomingText).split(/\s+/).filter(Boolean);
    if (previousWords.length < 3 || incomingWords.length < 3) return false;
    const shorter = Math.min(previousWords.length, incomingWords.length);
    const sharedPrefix = countCommonPrefixWords(previousWords, incomingWords);
    const sharedWords = countWordMatches(previousWords, incomingWords);
    const prefixStrongEnough = sharedPrefix >= 3 && sharedWords / shorter >= 0.58;
    const overlapStrongEnough = sharedWords / shorter >= 0.72;
    return prefixStrongEnough || overlapStrongEnough;
};

const mergeSpeechRevision = (previousText, incomingText) => {
    const previous = cleanLiveSpeechText(previousText);
    const incoming = cleanLiveSpeechText(incomingText);
    if (!previous) return incoming;
    if (!incoming) return previous;
    if (!isLikelySpeechRevision(previous, incoming)) return mergeLiveTranscript(previous, incoming);
    return incoming.length >= previous.length * 0.72 ? incoming : previous;
};

const countOverlapWords = (leftWords, rightWords, maxSize = 24) => {
    const maxOverlap = Math.min(leftWords.length, rightWords.length, maxSize);
    for (let size = maxOverlap; size >= 2; size -= 1) {
        if (leftWords.slice(-size).join(' ') === rightWords.slice(0, size).join(' ')) return size;
    }
    return 0;
};

const countCommonPrefixWords = (leftWords, rightWords) => {
    const maxLength = Math.min(leftWords.length, rightWords.length);
    let count = 0;
    while (count < maxLength && leftWords[count] === rightWords[count]) count += 1;
    return count;
};

const AMBIENT_MUTABLE_TAIL_WORDS = 14;
const AMBIENT_STABLE_PARTIAL_WORDS = 32;
const AMBIENT_PARAGRAPH_WORDS = 32;
const AMBIENT_VISIBLE_PARAGRAPHS = 5;
const usesFullSessionPartialResults = () => Capacitor.getPlatform() === 'ios';

const cleanRawAmbientText = text => stripLivePunctuation(text);

const appendRawAmbientTranscript = (baseText, incomingText) => {
    const base = cleanRawAmbientText(baseText);
    const incoming = cleanRawAmbientText(incomingText);
    if (!base) return incoming;
    if (!incoming) return base;

    const baseKey = normalizeTranscriptForMerge(base);
    const incomingKey = normalizeTranscriptForMerge(incoming);
    if (!baseKey) return incoming;
    if (!incomingKey) return base;
    if (baseKey === incomingKey) return base;
    if (incomingKey.startsWith(`${baseKey} `)) return incoming;
    if (baseKey.endsWith(` ${incomingKey}`) || baseKey.includes(` ${incomingKey} `)) return base;

    const baseWords = base.split(/\s+/).filter(Boolean);
    const incomingWords = incoming.split(/\s+/).filter(Boolean);
    const baseCompareWords = baseKey.split(/\s+/).filter(Boolean);
    const incomingCompareWords = incomingKey.split(/\s+/).filter(Boolean);
    const overlap = countOverlapWords(baseCompareWords, incomingCompareWords, 16);
    return [...baseWords, ...incomingWords.slice(overlap)].join(' ').trim();
};

const composeRawAmbientTranscript = (committedText, draftText) => appendRawAmbientTranscript(committedText, draftText);

const splitAmbientStableTail = text => {
    const words = splitWords(text);
    if (usesFullSessionPartialResults()) return { stable: '', tail: words.join(' ') };
    if (words.length <= AMBIENT_STABLE_PARTIAL_WORDS) return { stable: '', tail: words.join(' ') };
    return {
        stable: words.slice(0, -AMBIENT_MUTABLE_TAIL_WORDS).join(' '),
        tail: words.slice(-AMBIENT_MUTABLE_TAIL_WORDS).join(' ')
    };
};

const stripAmbientCommittedCarryover = (committedText, incomingText) => {
    const incoming = cleanRawAmbientText(incomingText);
    const committed = cleanRawAmbientText(committedText);
    if (!incoming || !committed) return incoming;

    const committedWords = normalizeTranscriptForMerge(committed).split(/\s+/).filter(Boolean);
    const incomingWords = normalizeTranscriptForMerge(incoming).split(/\s+/).filter(Boolean);
    const originalIncomingWords = incoming.split(/\s+/).filter(Boolean);
    if (committedWords.length < 4 || incomingWords.length < 4) return incoming;

    const committedTail = committedWords.slice(-80);
    let exactPrefix = 0;
    const comparable = Math.min(committedTail.length, incomingWords.length);
    for (let index = 0; index < comparable; index += 1) {
        if (committedTail[index] !== incomingWords[index]) break;
        exactPrefix += 1;
    }

    const fuzzyPrefix = findFuzzyCarryoverPrefixLength(committedTail, incomingWords);
    const consumed = Math.max(exactPrefix, fuzzyPrefix);
    if (consumed >= 4 && originalIncomingWords.length > consumed) {
        return originalIncomingWords.slice(consumed).join(' ').trim();
    }

    return incoming;
};

const updateAmbientLiveTail = (committedRef, draftRef, rawText, final = false) => {
    const incoming = stripAmbientCommittedCarryover(committedRef.current, rawText);
    if (!incoming) return false;

    const previousDraft = draftRef.current;
    const sameChunk = !previousDraft || isSameLiveSpeechChunk(previousDraft, incoming);
    if (!sameChunk) {
        committedRef.current = appendRawAmbientTranscript(committedRef.current, previousDraft);
        draftRef.current = incoming;
    } else if (previousDraft) {
        draftRef.current = cleanRawAmbientText(mergeSpeechRevision(previousDraft, incoming));
    } else {
        draftRef.current = incoming;
    }

    if (final) {
        committedRef.current = appendRawAmbientTranscript(committedRef.current, draftRef.current);
        draftRef.current = '';
        return true;
    }

    const { stable, tail } = splitAmbientStableTail(draftRef.current);
    if (stable) {
        committedRef.current = appendRawAmbientTranscript(committedRef.current, stable);
        draftRef.current = tail;
    }
    return true;
};

const buildAmbientParagraphs = (text, confidence, live = true) => {
    const words = splitWords(cleanRawAmbientText(text));
    if (!words.length) return [];
    const now = Date.now();
    const paragraphs = [];
    for (let index = 0; index < words.length; index += AMBIENT_PARAGRAPH_WORDS) {
        const paragraphIndex = Math.floor(index / AMBIENT_PARAGRAPH_WORDS);
        const chunk = words.slice(index, index + AMBIENT_PARAGRAPH_WORDS).join(' ').trim();
        if (!chunk) continue;
        paragraphs.push({
            id: `ambient-p-${paragraphIndex}`,
            text: chunk,
            rawText: chunk,
            timestamp: now,
            uncertain: confidence != null && confidence < 0.62,
            live: live && index + AMBIENT_PARAGRAPH_WORDS >= words.length
        });
    }
    return paragraphs;
};

const escapeHtml = value => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const createAmbientWordHtml = session => {
    const createdAt = new Date(session.createdAt || Date.now()).toLocaleString('tr-TR');
    const paragraphs = Array.isArray(session.captions) && session.captions.length
        ? session.captions.map(line => line.text)
        : String(session.transcriptText || '').split(/\n{2,}/);
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(session.title || 'Eary Ortam Dinleme')}</title>
<style>
body { font-family: Arial, sans-serif; color: #13231f; margin: 32px; }
h1 { font-size: 24px; margin: 0 0 8px; }
.meta { color: #65736f; font-size: 12px; margin-bottom: 28px; }
p { font-size: 18px; line-height: 1.55; margin: 0 0 18px; }
</style>
</head>
<body>
<h1>${escapeHtml(session.title || 'Eary Ortam Dinleme')}</h1>
<div class="meta">${escapeHtml(createdAt)} · ${escapeHtml(getLanguageLabel(session.language || 'tr-TR'))}</div>
${paragraphs.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join('\n')}
</body>
</html>`;
};

const exportWordDocument = async session => {
    const safeDate = new Date(session.createdAt || Date.now()).toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const filename = `Eary-Ortam-Dinleme-${safeDate}.doc`;
    const blob = new Blob(['\ufeff', createAmbientWordHtml(session)], { type: 'application/msword' });
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: session.title || 'Eary Ortam Dinleme', files: [file] });
        return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
};

const isSameLiveSpeechChunk = (previousText, nextText) => {
    const previousKey = normalizeTranscriptForMerge(previousText);
    const nextKey = normalizeTranscriptForMerge(nextText);
    if (!previousKey || !nextKey) return true;
    if (previousKey === nextKey) return true;
    if (previousKey.startsWith(`${nextKey} `) || nextKey.startsWith(`${previousKey} `)) return true;
    if (previousKey.includes(` ${nextKey} `) || nextKey.includes(` ${previousKey} `)) return true;
    const previousWords = previousKey.split(/\s+/).filter(Boolean);
    const nextWords = nextKey.split(/\s+/).filter(Boolean);
    const sharedPrefix = countCommonPrefixWords(previousWords, nextWords);
    if (sharedPrefix >= Math.min(3, previousWords.length, nextWords.length)) return true;
    return countOverlapWords(previousWords, nextWords) >= 2 || countOverlapWords(nextWords, previousWords) >= 2;
};

const joinPlainTranscript = (baseText, incomingText, language = null, options = {}) => cleanLiveDictationText(mergeLongLiveTranscript(baseText, incomingText), language, options);

const getRecentTranscriptWindow = (...values) => splitWords(values.join(' ')).slice(-140).join(' ');

const findFuzzyCarryoverPrefixLength = (knownWords, incomingWords) => {
    if (knownWords.length < 4 || incomingWords.length < 4) return 0;
    let bestConsumed = 0;
    let bestScore = 0;

    for (let start = 0; start <= knownWords.length - 3; start += 1) {
        let knownIndex = start;
        let incomingIndex = 0;
        let matched = 0;
        let misses = 0;

        while (knownIndex < knownWords.length && incomingIndex < incomingWords.length && misses <= 3) {
            if (knownWords[knownIndex] === incomingWords[incomingIndex]) {
                matched += 1;
                knownIndex += 1;
                incomingIndex += 1;
                continue;
            }
            if (incomingIndex + 1 < incomingWords.length && knownWords[knownIndex] === incomingWords[incomingIndex + 1]) {
                incomingIndex += 1;
                misses += 1;
                continue;
            }
            if (knownIndex + 1 < knownWords.length && knownWords[knownIndex + 1] === incomingWords[incomingIndex]) {
                knownIndex += 1;
                misses += 1;
                continue;
            }
            knownIndex += 1;
            incomingIndex += 1;
            misses += 1;
        }

        const consumed = incomingIndex;
        const score = matched / Math.max(1, Math.min(consumed, knownWords.length - start));
        if (matched >= 4 && consumed >= 4 && score >= 0.62 && score > bestScore) {
            bestScore = score;
            bestConsumed = consumed;
        }
    }

    return bestConsumed;
};

const stripKnownTranscriptCarryover = (knownText, incomingText, language = null, options = {}) => {
    const incoming = cleanLiveDictationText(incomingText, language, options);
    const known = cleanLiveDictationText(knownText, language, options);
    if (!known || !incoming) return incoming;

    const knownWords = normalizeTranscriptForMerge(known).split(/\s+/).filter(Boolean);
    const incomingWords = normalizeTranscriptForMerge(incoming).split(/\s+/).filter(Boolean);
    const originalIncomingWords = incoming.split(/\s+/).filter(Boolean);
    if (knownWords.length < 4 || incomingWords.length < 4) return incoming;

    let bestMatch = 0;
    for (let start = 0; start <= knownWords.length - 4; start += 1) {
        let length = 0;
        while (
            start + length < knownWords.length &&
            length < incomingWords.length &&
            knownWords[start + length] === incomingWords[length]
        ) {
            length += 1;
        }
        if (length > bestMatch) bestMatch = length;
    }

    const fuzzyPrefix = findFuzzyCarryoverPrefixLength(knownWords, incomingWords);
    const overlapLength = Math.max(bestMatch, fuzzyPrefix);
    const isLikelyCarryover = overlapLength >= 6 || overlapLength >= Math.ceil(incomingWords.length * 0.45);
    if (!isLikelyCarryover) return incoming;
    return originalIncomingWords.slice(overlapLength).join(' ').trim();
};

const updatePlainTranscriptTape = (baseRef, liveRef, rawText, language = null, options = {}) => {
    const knownText = getRecentTranscriptWindow(baseRef.current, liveRef.current);
    const incoming = stripKnownTranscriptCarryover(knownText, rawText, language, options);
    if (!incoming) return '';

    const previousLive = liveRef.current.trim();
    if (previousLive && !isSameLiveSpeechChunk(previousLive, incoming)) {
        baseRef.current = joinPlainTranscript(baseRef.current, previousLive, language, options);
        liveRef.current = incoming;
        return joinPlainTranscript(baseRef.current, liveRef.current, language, options);
    }

    liveRef.current = previousLive ? cleanLiveDictationText(mergeSpeechRevision(previousLive, incoming), language, options) : incoming;
    return joinPlainTranscript(baseRef.current, liveRef.current, language, options);
};

const flushPlainTranscriptTape = (baseRef, liveRef, language = null, options = {}) => {
    if (liveRef.current.trim()) {
        baseRef.current = joinPlainTranscript(baseRef.current, liveRef.current, language, options);
        liveRef.current = '';
    }
    return cleanLiveDictationText(baseRef.current, language, options);
};

const loadJson = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; }
};

const RECENT_ACTIVITIES_KEY = 'eary_recent_activities';

const rememberActivity = (type, payload = {}) => {
    try {
        const current = loadJson(RECENT_ACTIVITIES_KEY, []);
        const item = {
            id: payload.id || `${type}-${Date.now()}`,
            type,
            title: payload.title || 'Eary aktivitesi',
            preview: String(payload.preview || '').trim(),
            createdAt: payload.createdAt || Date.now(),
            meta: payload.meta || '',
            sessionId: payload.sessionId || null,
            roomId: payload.roomId || null,
            transcriptText: String(payload.transcriptText || '').trim(),
            processedText: String(payload.processedText || '').trim(),
            messages: Array.isArray(payload.messages)
                ? payload.messages.slice(-80).map(message => ({
                    id: message.id,
                    side: message.side,
                    text: String(message.text || '').trim(),
                    translation: String(message.translation || '').trim(),
                    sourceLang: message.sourceLang || '',
                    createdAt: message.createdAt || Date.now()
                })).filter(message => message.text)
                : []
        };
        const next = [item, ...current.filter(activity => activity.id !== item.id)].slice(0, 60);
        localStorage.setItem(RECENT_ACTIVITIES_KEY, JSON.stringify(next));
    } catch {
        // Home-screen activity history is optional.
    }
};

const speakTurkish = text => {
    if (Capacitor.isNativePlatform()) {
        VoiceSettings.speakTurkish({ text }).catch(console.error);
        return;
    }
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    utterance.voice = voices.find(voice => voice.lang?.toLowerCase() === 'tr-tr')
        || voices.find(voice => voice.lang?.toLowerCase().startsWith('tr'))
        || null;
    utterance.lang = 'tr-TR';
    utterance.rate = 0.88;
    utterance.pitch = 1;
    utterance.volume = 1;
    window.speechSynthesis.speak(utterance);
};

const translateText = async (text, targetLang, sourceLang = 'auto') => {
    try {
        const target = targetLang.split('-')[0];
        const source = sourceLang === 'auto' ? 'auto' : sourceLang.split('-')[0];
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${source}&tl=${target}&dt=t&q=${encodeURIComponent(text)}`;
        const response = await fetch(url);
        if (!response.ok) return '';
        const data = await response.json();
        return data?.[0]?.map(item => item?.[0] || '').join('').trim() || '';
    } catch {
        return '';
    }
};

const shouldStopAmbientOnError = error => {
    const value = String(error?.message || error?.error || error?.code || error || '').toLowerCase();
    return ['not-allowed', 'permission', 'denied', 'security', 'blocked'].some(token => value.includes(token));
};

function AmbientListeningTool({ onBack, appLanguage, account }) {
    const preferredLanguage = normalizeAppLanguage(appLanguage || getInitialAppLanguage());
    const [captions, setCaptions] = useState([]);
    const [interim, setInterim] = useState('');
    const [listening, setListening] = useState(false);
    const [saved, setSaved] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [showFullTranscript, setShowFullTranscript] = useState(false);
    const [languageSaved, setLanguageSaved] = useState(false);
    const [contextId, setContextId] = useState(() => localStorage.getItem('eary_ambient_context') || 'general');
    const [language, setLanguage] = useState(() => normalizeAppLanguage(appLanguage || localStorage.getItem('eary_ambient_language') || getInitialAppLanguage()));
    const [draftLanguage, setDraftLanguage] = useState(() => normalizeAppLanguage(appLanguage || localStorage.getItem('eary_ambient_language') || getInitialAppLanguage()));
    const [translateEnabled, setTranslateEnabled] = useState(() => localStorage.getItem('eary_ambient_translate') === 'true');
    const [translationTargetLang, setTranslationTargetLang] = useState(() => localStorage.getItem('eary_ambient_translate_target') || 'tr-TR');
    const [captionTranslations, setCaptionTranslations] = useState({});
    const recognizerRef = useRef(null);
    const scrollRef = useRef(null);
    const autoScrollAmbientRef = useRef(true);
    const desiredListeningRef = useRef(false);
    const ambientDraftRef = useRef('');
    const ambientCommittedRef = useRef('');
    const ambientProcessedTextRef = useRef('');
    const ambientBackgroundTimerRef = useRef(null);
    const startInFlightRef = useRef(false);
    const pendingCaptionFrameRef = useRef(null);
    const pendingCaptionRef = useRef(null);
    const lastActivitySyncRef = useRef({ at: 0, length: 0 });
    const contextConfig = MODE_CONFIG[contextId] || MODE_CONFIG.general;
    const text = uiText(language);
    const speechTerms = buildSpeechPersonalTerms(account);
    const hiddenCaptionCount = Math.max(0, captions.length - AMBIENT_VISIBLE_PARAGRAPHS);
    const displayedCaptions = showFullTranscript ? captions : captions.slice(-AMBIENT_VISIBLE_PARAGRAPHS);
    const hasUnsavedLanguage = normalizeAppLanguage(draftLanguage) !== normalizeAppLanguage(language);
    const runAfterUiPaint = callback => {
        requestAnimationFrame(() => {
            setTimeout(callback, 30);
        });
    };

    useEffect(() => () => {
        desiredListeningRef.current = false;
        if (pendingCaptionFrameRef.current) cancelAnimationFrame(pendingCaptionFrameRef.current);
        stopAmbientBackgroundWork();
        recognizerRef.current?.abort?.();
    }, []);
    useEffect(() => {
        if (!listening && language !== preferredLanguage) {
            setLanguage(preferredLanguage);
            setDraftLanguage(preferredLanguage);
        }
    }, [language, listening, preferredLanguage]);
    useEffect(() => localStorage.setItem('eary_ambient_context', contextId), [contextId]);
    useEffect(() => localStorage.setItem('eary_ambient_language', language), [language]);
    useEffect(() => localStorage.setItem('eary_ambient_translate', String(translateEnabled)), [translateEnabled]);
    useEffect(() => localStorage.setItem('eary_ambient_translate_target', translationTargetLang), [translationTargetLang]);
    useEffect(() => {
        setCaptionTranslations({});
    }, [contextId, language]);
    useEffect(() => {
        if (scrollRef.current && autoScrollAmbientRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [captions, interim]);
    useEffect(() => {
        if (listening || !translateEnabled || !captions.length) return;
        const untranslated = captions.filter(line => line.text && !captionTranslations[line.id]);
        if (!untranslated.length) return;
        let cancelled = false;
        untranslated.slice(-4).forEach(async line => {
            const translated = await translateText(line.text, translationTargetLang, language);
            if (cancelled || !translated || translated.toLocaleLowerCase('tr-TR') === line.text.toLocaleLowerCase('tr-TR')) return;
            setCaptionTranslations(current => ({
                ...current,
                [line.id]: translated
            }));
        });
        return () => {
            cancelled = true;
        };
    }, [captions, captionTranslations, language, listening, translateEnabled, translationTargetLang]);
    const getAmbientDisplayText = () => composeRawAmbientTranscript(ambientCommittedRef.current, ambientDraftRef.current);

    const saveAmbientLanguage = () => {
        if (listening) return;
        const nextLanguage = normalizeAppLanguage(draftLanguage);
        setLanguage(nextLanguage);
        localStorage.setItem('eary_ambient_language', nextLanguage);
        localStorage.setItem('eary_speech_lang', nextLanguage);
        localStorage.setItem('eary_app_language', nextLanguage);
        setCaptionTranslations({});
        setLanguageSaved(true);
        window.dispatchEvent(new CustomEvent('eary:toast', { detail: `${getLanguageLabel(nextLanguage)} dili kaydedildi` }));
        setTimeout(() => setLanguageSaved(false), 1800);
    };
    const queueAmbientCaption = (displayText, confidence, live = true) => {
        if (!displayText) return;
        setInterim('');
        pendingCaptionRef.current = buildAmbientParagraphs(displayText, confidence, live);
        if (!pendingCaptionFrameRef.current) {
            pendingCaptionFrameRef.current = requestAnimationFrame(() => {
                pendingCaptionFrameRef.current = null;
                if (pendingCaptionRef.current) setCaptions(pendingCaptionRef.current);
            });
        }
    };

    const syncAmbientBackgroundWork = (force = false) => {
        const displayText = getAmbientDisplayText();
        if (!displayText) return;
        const now = Date.now();
        const lastSync = lastActivitySyncRef.current;
        if (force || now - lastSync.at >= 10000 || Math.abs(displayText.length - lastSync.length) > 320) {
            lastActivitySyncRef.current = { at: now, length: displayText.length };
            ambientProcessedTextRef.current = cleanListeningText(displayText, language, { personalTerms: speechTerms, context: contextId, finalize: true }) || displayText;
            rememberActivity('ambient', {
                id: 'ambient-current',
                title: 'Ortam dinleme',
                preview: displayText,
                createdAt: now,
                meta: contextConfig.title,
                transcriptText: displayText,
                processedText: ambientProcessedTextRef.current
            });
        }
    };

    const startAmbientBackgroundWork = () => {
        if (ambientBackgroundTimerRef.current) clearInterval(ambientBackgroundTimerRef.current);
        ambientBackgroundTimerRef.current = setInterval(() => syncAmbientBackgroundWork(false), 10000);
    };

    const stopAmbientBackgroundWork = () => {
        if (!ambientBackgroundTimerRef.current) return;
        clearInterval(ambientBackgroundTimerRef.current);
        ambientBackgroundTimerRef.current = null;
    };

    const updateLiveCaption = (rawText, confidence, final = false) => {
        if (!updateAmbientLiveTail(ambientCommittedRef, ambientDraftRef, rawText, final)) return;
        queueAmbientCaption(getAmbientDisplayText(), confidence, true);
    };

    const commitAmbientDraft = () => {
        if (ambientDraftRef.current.trim()) {
            ambientCommittedRef.current = appendRawAmbientTranscript(ambientCommittedRef.current, ambientDraftRef.current);
            ambientDraftRef.current = '';
        }
        const finalText = getAmbientDisplayText();
        if (!finalText) return;
        if (pendingCaptionFrameRef.current) {
            cancelAnimationFrame(pendingCaptionFrameRef.current);
            pendingCaptionFrameRef.current = null;
        }
        const finalCaptions = buildAmbientParagraphs(finalText, null, false);
        pendingCaptionRef.current = finalCaptions;
        setCaptions(finalCaptions);
        syncAmbientBackgroundWork(true);
    };

    const commitInterimCaption = () => {
        commitAmbientDraft();
        setInterim('');
    };

    const startListening = async () => {
        if (startInFlightRef.current) return;
        desiredListeningRef.current = true;
        startInFlightRef.current = true;
        setListening(true);
        const recognizer = getDuoSpeechRecognizer(language, (finalText, interimText, confidence) => {
            if (interimText) updateLiveCaption(interimText, confidence);
            if (finalText?.trim()) updateLiveCaption(finalText, confidence, true);
        }, () => {
            startInFlightRef.current = false;
            if (desiredListeningRef.current) {
                if (ambientDraftRef.current.trim()) {
                    ambientCommittedRef.current = appendRawAmbientTranscript(ambientCommittedRef.current, ambientDraftRef.current);
                    ambientDraftRef.current = '';
                    queueAmbientCaption(getAmbientDisplayText(), null, true);
                }
                setListening(true);
                return;
            }
            setListening(false);
        }, error => {
            startInFlightRef.current = false;
            if (desiredListeningRef.current && !shouldStopAmbientOnError(error)) {
                if (ambientDraftRef.current.trim()) {
                    ambientCommittedRef.current = appendRawAmbientTranscript(ambientCommittedRef.current, ambientDraftRef.current);
                    ambientDraftRef.current = '';
                    queueAmbientCaption(getAmbientDisplayText(), null, true);
                }
                setListening(true);
                return;
            }
            desiredListeningRef.current = false;
            setListening(false);
            setInterim(String(error?.message || 'Mikrofon başlatılamadı'));
            setTimeout(() => setInterim(''), 2400);
        });
        recognizerRef.current = recognizer;
        try {
            await recognizer.start();
            startInFlightRef.current = false;
            startAmbientBackgroundWork();
            setListening(true);
        } catch (error) {
            startInFlightRef.current = false;
            if (desiredListeningRef.current && !shouldStopAmbientOnError(error)) {
                setListening(true);
                return;
            }
            desiredListeningRef.current = false;
            setListening(false);
            setInterim(String(error?.message || 'Mikrofon başlatılamadı'));
            setTimeout(() => setInterim(''), 2400);
        }
    };

    const stopListening = () => {
        desiredListeningRef.current = false;
        startInFlightRef.current = false;
        commitAmbientDraft();
        stopAmbientBackgroundWork();
        setListening(false);
        const recognizer = recognizerRef.current;
        runAfterUiPaint(async () => {
            try {
                if (typeof recognizer?.stop === 'function') await recognizer.stop();
                else recognizer?.abort?.();
            } catch (error) {
                console.warn('Ambient speech recognition could not be stopped:', error);
            } finally {
                commitInterimCaption();
                recognizerRef.current = null;
            }
        });
    };

    const toggleListening = () => {
        if (listening) stopListening();
        else startListening();
    };

    const buildAmbientSession = () => {
        syncAmbientBackgroundWork(true);
        const transcriptText = captions.map(line => line.text).join('\n\n').trim();
        if (!transcriptText) return null;
        const processedText = cleanListeningText(transcriptText, language, { personalTerms: speechTerms, context: contextId, finalize: true }) || transcriptText;
        ambientProcessedTextRef.current = processedText;
        return {
            id: Date.now(),
            mode: 'ambient',
            title: text.ambientTitle,
            context: contextId,
            language,
            createdAt: Date.now(),
            captions,
            transcriptText,
            processedText
        };
    };

    const saveSession = () => {
        const session = buildAmbientSession();
        if (!session) return null;
        const sessions = loadJson('eary_caption_sessions', []);
        localStorage.setItem('eary_caption_sessions', JSON.stringify([session, ...sessions].slice(0, 30)));
        setSaved(true);
        setTimeout(() => setSaved(false), 1800);
        return session;
    };

    const exportSession = async () => {
        if (exporting) return;
        const session = saveSession();
        if (!session) return;
        setExporting(true);
        try {
            await exportWordDocument(session);
        } catch (error) {
            console.warn('Ambient export failed:', error);
        } finally {
            setExporting(false);
        }
    };

    const handleAmbientScroll = event => {
        const node = event.currentTarget;
        autoScrollAmbientRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
    };
    return (
        <main className="eary-shell mx-auto flex h-screen w-full max-w-md flex-col overflow-hidden sm:h-[800px] sm:rounded-xl sm:border sm:eary-line">
            <header className="eary-ios-safe-header flex items-center gap-3 border-b eary-line px-4 pb-3">
                <button type="button" onClick={onBack} className="eary-soft eary-muted flex h-10 w-10 items-center justify-center rounded-lg"><ArrowLeft size={20} /></button>
                <span className="eary-brand-bg flex h-10 w-10 items-center justify-center rounded-lg"><Captions size={20} /></span>
                <div className="min-w-0 flex-1">
                    <h1 className="font-bold">{text.ambientTitle}</h1>
                    <p className="eary-muted truncate text-[10px]">{text.ambientSubtitle}</p>
                </div>
                <button onClick={() => setTranslateEnabled(value => !value)} className={`flex h-10 w-10 items-center justify-center rounded-lg ${translateEnabled ? 'eary-brand-bg' : 'eary-soft eary-brand'}`} title="Çeviri"><Languages size={18}/></button>
                <button onClick={exportSession} disabled={!captions.length || exporting} className="eary-soft eary-brand flex h-10 w-10 items-center justify-center rounded-lg disabled:opacity-30" title="Word olarak dışa aktar"><FileText size={18}/></button>
                <button onClick={saveSession} disabled={!captions.length} className="eary-soft eary-brand flex h-10 w-10 items-center justify-center rounded-lg disabled:opacity-30" title="Oturumu kaydet">{saved ? <Check size={18}/> : <Save size={18}/>}</button>
            </header>

                        <section className="grid grid-cols-2 gap-2 border-b eary-line px-4 py-3">
                <label className="block text-[10px] font-black uppercase eary-muted">{text.speechLanguage}
                    <select value={draftLanguage} onChange={event => setDraftLanguage(event.target.value)} disabled={listening} className="eary-input mt-1 w-full rounded-lg border px-2 py-2 text-xs font-bold normal-case disabled:opacity-60">
                        {SUPPORTED_LANGUAGES.map(item => <option key={item.code} value={item.code}>{item.nativeLabel}</option>)}
                    </select>
                    {!listening && (hasUnsavedLanguage || languageSaved) && <button
                        type="button"
                        onClick={saveAmbientLanguage}
                        className="eary-brand-bg mt-2 w-full rounded-lg py-2 text-[10px] font-bold"
                    >
                        {languageSaved ? 'Kaydedildi' : 'Kaydet'}
                    </button>}
                </label>
                <label className="block text-[10px] font-black uppercase eary-muted">{text.context}
                    <select value={contextId} onChange={event => setContextId(event.target.value)} className="eary-input mt-1 w-full rounded-lg border px-2 py-2 text-xs font-bold normal-case">
                        {Object.entries(MODE_CONFIG).map(([id, config]) => <option key={id} value={id}>{config.title}</option>)}
                    </select>
                </label>
                {translateEnabled && (
                    <label className="col-span-2 block text-[10px] font-black uppercase eary-muted">{text.translation}
                        <select value={translationTargetLang} onChange={event => { setCaptionTranslations({}); setTranslationTargetLang(event.target.value); }} className="eary-input mt-1 w-full rounded-lg border px-2 py-2 text-xs font-bold normal-case">
                            <option value="tr-TR">Türkçe</option>
                            <option value="de-DE">Deutsch</option>
                            <option value="en-US">English</option>
                            <option value="fr-FR">Français</option>
                            <option value="es-ES">Español</option>
                            <option value="it-IT">Italiano</option>
                        </select>
                    </label>
                )}
            </section>

            <div ref={scrollRef} onScroll={handleAmbientScroll} className="flex-1 overflow-y-auto px-4 py-3">
                {captions.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center text-center">
                        <Captions size={36} className="eary-brand"/>
                        <h2 className="mt-3 font-bold">{text.liveCaptionsReady}</h2>
                        <p className="eary-muted mt-1 max-w-xs text-xs leading-5">{text.ambientReadyBody}</p>
                    </div>
                ) : (
                    <div className="py-3">
                        {hiddenCaptionCount > 0 && (
                            <button
                                type="button"
                                onClick={() => setShowFullTranscript(value => !value)}
                                className="mb-5 w-full rounded-lg border eary-line px-3 py-2 text-center text-[10px] font-bold eary-muted"
                            >
                                {showFullTranscript ? 'Sadece son konusmayi goster' : `${hiddenCaptionCount} onceki paragraf kayitta tutuluyor`}
                            </button>
                        )}
                        {displayedCaptions.map((line, index) => (
                            <article key={line.id} className={`${index ? 'mt-4' : ''}`}>
                                <p className={`text-[16px] font-semibold leading-8 text-[var(--text)] ${line.live ? 'opacity-95' : ''}`}>{line.text}</p>
                                {translateEnabled && captionTranslations[line.id] && (
                                    <div className="mt-4 text-sm font-semibold leading-7 text-emerald-950">
                                        <span className="mb-1 block text-[9px] font-black uppercase text-emerald-700">Ceviri - {getLanguageLabel(translationTargetLang)}</span>
                                        {captionTranslations[line.id]}
                                    </div>
                                )}
                            </article>
                        ))}
                    </div>
                )}
            </div>

            <div className="border-t eary-line bg-[var(--surface)] px-3 py-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                        <p className="text-xs font-bold">{listening ? text.micOn : text.micOff}</p>
                        <p className="eary-muted truncate text-[10px]">{getLanguageLabel(language)} - {contextConfig.title}{translateEnabled ? ` - ${getLanguageLabel(translationTargetLang)} ceviri` : ''}</p>
                    </div>
                    <button type="button" onClick={toggleListening} className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white shadow-lg ${listening ? 'bg-rose-600' : 'eary-brand-bg'}`}>{listening ? <StopCircle size={24}/> : <Mic size={24}/>}</button>
                </div>
                <div className="flex gap-2 overflow-x-auto">
                    {contextConfig.phrases.map(phrase => <button key={phrase} onClick={() => speakTurkish(phrase)} className="eary-soft eary-brand shrink-0 rounded-full px-3 py-2 text-[10px] font-bold">{phrase}</button>)}
                </div>
            </div>
        </main>
    );
}
function FaceToFaceTool({ onBack, appLanguage, account }) {
    const preferredLanguage = normalizeAppLanguage(appLanguage || getInitialAppLanguage());
    const [messages, setMessages] = useState([]);
    const [activeSide, setActiveSide] = useState('host');
    const [listening, setListening] = useState(false);
    const [interim, setInterim] = useState('');
    const [hostManualText, setHostManualText] = useState('');
    const [guestManualText, setGuestManualText] = useState('');
    const [translateEnabled, setTranslateEnabled] = useState(false);
    const [hostLang, setHostLang] = useState(() => normalizeAppLanguage(appLanguage || localStorage.getItem('eary_face_host_language') || localStorage.getItem('eary_speech_lang') || getInitialAppLanguage()));
    const [targetLang, setTargetLang] = useState(() => localStorage.getItem('eary_face_target_lang') || 'en-US');
    const [showOriginal, setShowOriginal] = useState({});
    const [showScrollDown, setShowScrollDown] = useState({ host: false, guest: false });
    const recognizerRef = useRef(null);
    const messagesRef = useRef([]);
    const activeSideRef = useRef('host');
    const partialRef = useRef('');
    const faceCommittedRef = useRef('');
    const faceLiveRef = useRef('');
    const listeningRef = useRef(false);
    const desiredFaceListeningRef = useRef(false);
    const faceRestartTimerRef = useRef(null);
    const faceStartInFlightRef = useRef(false);
    const sentRef = useRef(false);
    const guestScrollRef = useRef(null);
    const hostScrollRef = useRef(null);
    const speechTerms = buildSpeechPersonalTerms(account);
    const [inviteCopied, setInviteCopied] = useState(false);
    const inviteUrl = account?.username ? `${window.location.origin}${window.location.pathname}?invite=${account.username}` : '';
    const inviteText = account?.nickname ? `${account.nickname} sizi Eary'de konuşmaya davet ediyor.` : 'Sizi Eary’de konuşmaya davet ediyorum.';

    useEffect(() => () => {
        desiredFaceListeningRef.current = false;
        faceStartInFlightRef.current = false;
        if (faceRestartTimerRef.current) clearTimeout(faceRestartTimerRef.current);
        recognizerRef.current?.abort?.();
    }, []);
    useEffect(() => {
        if (!listening && hostLang !== preferredLanguage) setHostLang(preferredLanguage);
    }, [hostLang, listening, preferredLanguage]);
    useEffect(() => {
        [guestScrollRef.current, hostScrollRef.current].forEach(node => {
            if (node) node.scrollTop = node.scrollHeight;
        });
    }, [messages, interim, activeSide, listening]);
    useEffect(() => {
        messagesRef.current = messages;
    }, [messages]);
    useEffect(() => {
        if (targetLang !== hostLang) return;
        setTargetLang(SUPPORTED_LANGUAGES.find(item => item.code !== hostLang)?.code || 'en-US');
    }, [hostLang, targetLang]);
    useEffect(() => localStorage.setItem('eary_face_host_language', hostLang), [hostLang]);
    useEffect(() => localStorage.setItem('eary_face_target_lang', targetLang), [targetLang]);

    const getSideLanguage = side => (translateEnabled && side === 'guest' ? targetLang : hostLang);
    const getTranslationTarget = side => (side === 'guest' ? hostLang : targetLang);
    const getOriginalToggleText = side => {
        if (side === 'host') return 'Orijinalini göster';
        if (!translateEnabled) return 'Orijinalini göster';
        if (targetLang.startsWith('de')) return 'Original zeigen';
        if (targetLang.startsWith('en')) return 'Show original';
        if (targetLang.startsWith('fr')) return "Voir l'original";
        if (targetLang.startsWith('es')) return 'Ver original';
        if (targetLang.startsWith('it')) return 'Mostra originale';
        return 'Orijinalini göster';
    };
    const getTranslationToggleText = side => {
        if (side === 'host') return 'Çeviriyi göster';
        if (!translateEnabled) return 'Çeviriyi göster';
        if (targetLang.startsWith('de')) return 'Übersetzung zeigen';
        if (targetLang.startsWith('en')) return 'Show translation';
        if (targetLang.startsWith('fr')) return 'Voir la traduction';
        if (targetLang.startsWith('es')) return 'Ver traducción';
        if (targetLang.startsWith('it')) return 'Mostra traduzione';
        return 'Çeviriyi göster';
    };
    const updateScrollState = (side, node) => {
        if (!node) return;
        const shouldShow = node.scrollHeight - node.scrollTop - node.clientHeight > 48;
        setShowScrollDown(current => current[side] === shouldShow ? current : { ...current, [side]: shouldShow });
    };
    const scrollToBottom = side => {
        const node = side === 'host' ? hostScrollRef.current : guestScrollRef.current;
        if (!node) return;
        node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
        setShowScrollDown(current => ({ ...current, [side]: false }));
    };

    const copyInvite = async () => {
        if (!inviteUrl) return;
        await navigator.clipboard.writeText(inviteUrl);
        setInviteCopied(true);
        setTimeout(() => setInviteCopied(false), 1800);
    };

    const shareInvite = async () => {
        if (!inviteUrl) return;
        if (navigator.share) {
            await navigator.share({ title: 'Eary daveti', text: inviteText, url: inviteUrl }).catch(() => {});
            return;
        }
        await copyInvite();
    };

    const addMessage = async (side, text) => {
        const sourceLang = getSideLanguage(side);
        const clean = limitFaceMessageText(correctTranscription(String(text || '').replace(/\s+/g, ' ').trim(), sourceLang, {
            context: 'face',
            finalize: true
        }));
        if (!clean) return;
        const translationTarget = getTranslationTarget(side);
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const item = { id, side, text: clean, translation: '', sourceLang, createdAt: Date.now() };
        const nextMessages = [...messagesRef.current, item];
        messagesRef.current = nextMessages;
        setMessages(nextMessages);
        rememberActivity('face', {
            id: 'face-current',
            title: 'Yüz yüze görüşme',
            preview: clean,
            createdAt: item.createdAt,
            meta: side === 'host' ? 'Ben' : 'Karşı taraf',
            messages: nextMessages
        });
        if (translateEnabled && sourceLang !== translationTarget) {
            const translation = await translateText(clean, translationTarget, sourceLang);
            if (translation && translation.toLocaleLowerCase('tr-TR') !== clean.toLocaleLowerCase('tr-TR')) {
                const translatedMessages = messagesRef.current.map(message => message.id === id ? { ...message, translation } : message);
                messagesRef.current = translatedMessages;
                setMessages(translatedMessages);
                rememberActivity('face', {
                    id: 'face-current',
                    title: 'Yüz yüze görüşme',
                    preview: clean,
                    createdAt: item.createdAt,
                    meta: side === 'host' ? 'Ben' : 'Karşı taraf',
                    messages: translatedMessages
                });
            }
        }
    };

    const commitSpeech = async () => {
        const text = limitFaceMessageText(flushPlainTranscriptTape(faceCommittedRef, faceLiveRef, hostLang, { personalTerms: speechTerms, context: 'face' }));
        if (!text || sentRef.current) return;
        sentRef.current = true;
        partialRef.current = '';
        faceCommittedRef.current = '';
        faceLiveRef.current = '';
        setInterim('');
        await addMessage(activeSideRef.current, text);
        sentRef.current = false;
    };

    const stopListening = async () => {
        desiredFaceListeningRef.current = false;
        faceStartInFlightRef.current = false;
        if (faceRestartTimerRef.current) {
            clearTimeout(faceRestartTimerRef.current);
            faceRestartTimerRef.current = null;
        }
        listeningRef.current = false;
        setListening(false);
        await recognizerRef.current?.stop?.();
        await new Promise(resolve => setTimeout(resolve, 180));
        await commitSpeech();
        recognizerRef.current = null;
    };

    const restartFaceRecognizer = (delay = 70) => {
        if (faceRestartTimerRef.current) clearTimeout(faceRestartTimerRef.current);
        faceRestartTimerRef.current = setTimeout(() => {
            faceRestartTimerRef.current = null;
            if (desiredFaceListeningRef.current) startListening(activeSideRef.current, { restarting: true });
        }, delay);
    };

    const startListening = async (side, options = {}) => {
        if (faceStartInFlightRef.current) return;
        if (listeningRef.current && activeSideRef.current !== side) {
            await stopListening();
        } else if (listeningRef.current && activeSideRef.current === side) {
            return;
        }
        desiredFaceListeningRef.current = true;
        faceStartInFlightRef.current = true;
        activeSideRef.current = side;
        setActiveSide(side);
        if (!options.restarting) {
            partialRef.current = '';
            faceCommittedRef.current = '';
            faceLiveRef.current = '';
            sentRef.current = false;
            setInterim('');
        }
        const recognizerLang = getSideLanguage(side);
        const recognizer = getDuoSpeechRecognizer(
            recognizerLang,
            (finalText, interimText) => {
                const finalChunk = String(finalText || '').trim();
                const interimChunk = String(interimText || '').trim();
                const chunk = finalChunk || interimChunk;
                if (!chunk) return;
                const nextText = updatePlainTranscriptTape(faceCommittedRef, faceLiveRef, chunk, hostLang, { personalTerms: speechTerms, context: 'face' });
                if (!nextText) return;
                const limitedText = limitFaceMessageText(nextText);
                partialRef.current = limitedText;
                setInterim(limitedText);
            },
            () => {
                faceStartInFlightRef.current = false;
                if (desiredFaceListeningRef.current) {
                    listeningRef.current = true;
                    setListening(true);
                    restartFaceRecognizer(60);
                    return;
                }
                listeningRef.current = false;
                setListening(false);
            },
            error => {
                faceStartInFlightRef.current = false;
                if (desiredFaceListeningRef.current && !shouldStopAmbientOnError(error)) {
                    listeningRef.current = true;
                    setListening(true);
                    restartFaceRecognizer(90);
                    return;
                }
                desiredFaceListeningRef.current = false;
                listeningRef.current = false;
                setListening(false);
                setInterim(String(error?.message || 'Mikrofon başlatılamadı'));
                setTimeout(() => setInterim(''), 2200);
            }
        );
        recognizerRef.current = recognizer;
        listeningRef.current = true;
        setListening(true);
        try {
            await recognizer.start();
            faceStartInFlightRef.current = false;
        } catch (error) {
            faceStartInFlightRef.current = false;
            if (desiredFaceListeningRef.current && !shouldStopAmbientOnError(error)) {
                listeningRef.current = true;
                setListening(true);
                restartFaceRecognizer(120);
                return;
            }
            desiredFaceListeningRef.current = false;
            listeningRef.current = false;
            setListening(false);
            setInterim(String(error?.message || 'Mikrofon başlatılamadı'));
            setTimeout(() => setInterim(''), 2200);
        }
    };

    const handleMic = side => {
        if (listening && activeSide === side) stopListening();
        else startListening(side);
    };

    const sendManual = side => {
        const text = limitFaceMessageText(side === 'host' ? hostManualText : guestManualText);
        if (!text) return;
        if (side === 'host') setHostManualText('');
        else setGuestManualText('');
        addMessage(side, text);
    };

    const renderConversation = (side, rotated, scrollRef) => {
        const showInterim = listening && activeSide === side && interim;
        const isEmpty = messages.length === 0 && !showInterim;
        const viewerLang = getSideLanguage(side);
        return (
        <div className={`flex h-full min-h-0 flex-col overflow-hidden ${rotated ? 'rotate-180' : ''}`}>
            <div ref={scrollRef} onScroll={event => updateScrollState(side, event.currentTarget)} className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
                {isEmpty ? (
                    <div className="flex h-full items-center justify-center text-center">
                        <p className="max-w-[220px] text-xs font-semibold text-[#8A7E9F]">Konuşmak için kendi tarafınızdaki mikrofona dokunun.</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {messages.map(message => {
                            const viewerCanUseTranslation = message.translation && message.sourceLang !== viewerLang;
                            const originalVisible = showOriginal[`${side}:${message.id}`] || !viewerCanUseTranslation;
                            const visibleText = originalVisible ? message.text : message.translation;
                            return (
                                <article key={message.id} className={`max-w-[86%] rounded-lg border px-3 py-2 shadow-sm ${message.side === 'host' ? 'ml-auto border-emerald-200 bg-emerald-50 text-[#17372C]' : 'mr-auto border-violet-100 bg-white text-[#2D1F47]'}`}>
                                    <p className="mb-0.5 text-[8px] font-black uppercase text-[#8A7E9F]">{message.side === 'host' ? 'Ben' : 'Karşı taraf'}</p>
                                    <p className="text-[15px] font-bold leading-6">{visibleText}</p>
                                    {viewerCanUseTranslation && (
                                        <button
                                            type="button"
                                            onClick={() => setShowOriginal(current => ({ ...current, [`${side}:${message.id}`]: !current[`${side}:${message.id}`] }))}
                                            className="ml-auto mt-1.5 block text-[8px] font-black uppercase text-[#8A7E9F] underline decoration-dotted"
                                        >
                                            {originalVisible ? getTranslationToggleText(side) : getOriginalToggleText(side)}
                                        </button>
                                    )}
                                </article>
                            );
                        })}
                        {showInterim && (
                            <div className={`max-w-[86%] rounded-lg border border-dashed px-3 py-2 text-xs font-bold italic text-[#7B52AB] ${side === 'host' ? 'ml-auto' : 'mr-auto'}`}>{interim}</div>
                        )}
                    </div>
                )}
            </div>
            {showScrollDown[side] && <button type="button" onClick={() => scrollToBottom(side)} className={`absolute bottom-2 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-[#7B52AB] text-white shadow-lg ${rotated ? 'rotate-180' : ''}`}><ChevronRight size={18} className="rotate-90" /></button>}
        </div>
        );
    };

    const renderPanel = (side, rotated, scrollRef) => {
        const isHost = side === 'host';
        const value = isHost ? hostManualText : guestManualText;
        const setValue = isHost ? setHostManualText : setGuestManualText;
        const label = isHost ? 'Ben' : 'Karşı taraf';
        return (
            <section className={`flex min-h-0 flex-1 flex-col overflow-hidden ${isHost ? 'bg-[#FCFAF7]' : 'border-b eary-line bg-white/70'}`}>
                <div className={`flex h-full min-h-0 flex-col ${rotated ? 'rotate-180' : ''}`}>
                    <div className="relative min-h-0 flex-1 overflow-hidden">{renderConversation(side, false, scrollRef)}</div>
                    <div className="shrink-0 border-t eary-line bg-white px-2.5 py-2 pb-[max(8px,env(safe-area-inset-bottom))]">
                        <div className="grid grid-cols-[auto_1fr_auto] gap-2">
                            <button type="button" onClick={() => handleMic(side)} className={`flex h-10 w-10 items-center justify-center rounded-lg text-white shadow-sm ${listening && activeSide === side ? 'bg-rose-600' : 'bg-[#7B52AB]'}`} aria-label={`${label} mikrofonu`}>{listening && activeSide === side ? <StopCircle size={20} /> : <Mic size={20} />}</button>
                            <input value={value} onChange={event => setValue(event.target.value.slice(0, MAX_FACE_MESSAGE_CHARS))} maxLength={MAX_FACE_MESSAGE_CHARS} onKeyDown={event => { if (event.key === 'Enter') sendManual(side); }} placeholder={label} className="eary-input min-w-0 rounded-lg border px-3 py-2 text-sm" />
                            <button type="button" onClick={() => sendManual(side)} disabled={!value.trim()} className="rounded-lg bg-[#7B52AB] px-3 text-xs font-bold text-white disabled:opacity-35">Gönder</button>
                        </div>
                    </div>
                </div>
            </section>
        );
    };

    return (
        <main className="eary-shell mx-auto flex h-screen w-full max-w-md flex-col overflow-hidden bg-[#FCFAF7] text-[#2D1F47] sm:h-[800px] sm:rounded-xl sm:border sm:eary-line">
            <header className="eary-ios-safe-header flex items-center justify-between border-b eary-line px-3 pb-1.5">
                <button type="button" onClick={onBack} className="eary-soft eary-muted flex h-8 w-8 items-center justify-center rounded-lg"><ArrowLeft size={18} /></button>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#7B52AB] text-white"><PanelsTopLeft size={17} /></span>
                <div className="flex items-center gap-1.5">
                    {inviteUrl && (
                        <button type="button" onClick={shareInvite} className="eary-soft eary-brand flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[10px] font-black" title="Davet et">
                            <Share2 size={14} />
                            <span>{inviteCopied ? 'Kopyalandı' : 'Davet et'}</span>
                        </button>
                    )}
                    <button type="button" onClick={() => setTranslateEnabled(value => !value)} className={`flex h-8 w-8 items-center justify-center rounded-lg ${translateEnabled ? 'bg-[#7B52AB] text-white' : 'eary-soft eary-brand'}`} title="Çeviri"><Languages size={17} /></button>
                </div>
            </header>
            <div className="flex items-center gap-2 border-b eary-line px-3 py-1.5">
                <span className="text-[9px] font-black uppercase text-[#8A7E9F]">Benim konuşma dilim</span>
                <select value={hostLang} onChange={event => setHostLang(event.target.value)} disabled={listening} className="eary-input flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-bold disabled:opacity-60">
                    {SUPPORTED_LANGUAGES.map(item => <option key={item.code} value={item.code}>{item.nativeLabel}</option>)}
                </select>
            </div>
            {translateEnabled && (
                <div className="flex items-center gap-2 border-b eary-line px-3 py-1.5">
                    <span className="text-[9px] font-black uppercase text-[#8A7E9F]">Karşı tarafın dili</span>
                    <select value={targetLang} onChange={event => setTargetLang(event.target.value)} className="eary-input flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-bold">
                        <option value="en-US">English</option>
                        <option value="de-DE">Deutsch</option>
                        <option value="fr-FR">Français</option>
                        <option value="es-ES">Español</option>
                        <option value="it-IT">Italiano</option>
                    </select>
                </div>
            )}
            <div className="flex min-h-0 flex-1 flex-col">
                {renderPanel('guest', true, guestScrollRef)}
                {renderPanel('host', false, hostScrollRef)}
            </div>
        </main>
    );
}


function EmergencyCard({ nickname, onBack }) {
    const [editing, setEditing] = useState(false);
    const [data, setData] = useState(() => loadJson('eary_emergency_card', { name:nickname||'', message:'İşitme engelliyim. Lütfen benimle yazarak veya yüzüme bakarak yavaş konuşun.', emergencyContact:'', medicalNote:'' }));
    useEffect(()=>localStorage.setItem('eary_emergency_card',JSON.stringify(data)),[data]);
    return <main className="mx-auto flex h-screen w-full max-w-md flex-col overflow-hidden bg-white text-[#13231f] sm:h-[800px] sm:rounded-xl sm:border"><header className="eary-ios-safe-header flex items-center justify-between border-b border-red-100 px-4 pb-3"><button type="button" onClick={onBack} className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 text-red-700"><ArrowLeft size={20}/></button><h1 className="font-bold text-red-700">Acil İletişim Kartı</h1><button type="button" onClick={()=>setEditing(value=>!value)} className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{editing?'Bitti':'Düzenle'}</button></header>{editing?<div className="space-y-4 overflow-y-auto p-5">{[['name','Adınız'],['message','Ana mesaj'],['emergencyContact','Yakın telefon numarası'],['medicalNote','Ek sağlık/iletişim notu']].map(([key,label])=><label key={key} className="block text-xs font-bold">{label}{key==='message'||key==='medicalNote'?<textarea value={data[key]} onChange={event=>setData(current=>({...current,[key]:event.target.value}))} rows="4" className="eary-input mt-1.5 w-full rounded-lg border p-3 text-sm"/>:<input value={data[key]} onChange={event=>setData(current=>({...current,[key]:event.target.value}))} className="eary-input mt-1.5 w-full rounded-lg border p-3 text-sm"/>}</label>)}</div>:<div className="flex flex-1 flex-col justify-center px-6 text-center"><ShieldAlert size={52} className="mx-auto text-red-600"/><p className="mt-5 text-xl font-black uppercase tracking-wide">{data.name}</p><p className="mt-5 text-2xl font-bold leading-10">{data.message}</p>{data.medicalNote&&<p className="mt-5 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-900">{data.medicalNote}</p>}{data.emergencyContact&&<a href={`tel:${data.emergencyContact}`} className="mt-6 flex items-center justify-center gap-2 rounded-lg bg-red-600 py-4 text-lg font-bold text-white"><Phone size={22}/> Yakınımı ara</a>}<button type="button" onClick={()=>{const u=new SpeechSynthesisUtterance(data.message);u.lang='tr-TR';speechSynthesis.speak(u);}} className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-slate-100 py-3 text-sm font-bold"><Volume2 size={18}/> Karşı tarafa sesli oku</button></div>}</main>;
}

export default function AccessibilityHub({ account, onOpenChats, onOpenSettings, initialView = 'home', onBackHome, language, initialFaceSessionId = null }) {
    const appLanguage = normalizeAppLanguage(language || getInitialAppLanguage());
    const text = uiText(appLanguage);
    const [view, setView] = useState(initialView);
    const [quickContacts, setQuickContacts] = useState(() => loadJson('eary_quick_contacts', []));
    const [newContact, setNewContact] = useState({name:'',phone:''});
    const [showContacts, setShowContacts] = useState(false);
    const captionSessions = loadJson('eary_caption_sessions', []);
    useEffect(() => {
        const handleBack = event => {
            if (showContacts) {
                event.preventDefault();
                setShowContacts(false);
            } else if (view !== 'home') {
                event.preventDefault();
                if (initialView !== 'home' && onBackHome) onBackHome();
                else setView('home');
            }
        };
        window.addEventListener('eary:back', handleBack);
        return () => window.removeEventListener('eary:back', handleBack);
    }, [initialView, onBackHome, showContacts, view]);
    const goHome = () => {
        if (initialView !== 'home' && onBackHome) onBackHome();
        else setView('home');
    };
    if (view==='ambient') return <AmbientListeningTool onBack={goHome} appLanguage={appLanguage} account={account}/>;
    if (view==='emergency') return <EmergencyCard nickname={account?.nickname} onBack={goHome}/>;
    if (view==='face') return <FaceToFaceTool onBack={goHome} appLanguage={appLanguage} account={account} initialSessionId={initialFaceSessionId}/>;
    const addContact=()=>{if(!newContact.name.trim()||!newContact.phone.trim())return;const next=[...quickContacts,{id:Date.now(),...newContact}];setQuickContacts(next);localStorage.setItem('eary_quick_contacts',JSON.stringify(next));setNewContact({name:'',phone:''});};
    return (
        <main className="eary-shell eary-line relative mx-auto flex h-screen w-full max-w-md flex-col overflow-hidden sm:h-[780px] sm:rounded-xl sm:border sm:shadow-xl">
            <header className="eary-ios-safe-header border-b eary-line px-4 pb-4">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="eary-brand text-[10px] font-black uppercase">Eary Erişilebilirlik</p>
                        <h1 className="mt-1 text-xl font-bold">Bugün nasıl yardımcı olayım?</h1>
                    </div>
                    <button type="button" onClick={onOpenSettings} className="eary-soft eary-muted flex h-10 w-10 items-center justify-center rounded-lg"><UserRound size={20}/></button>
                </div>
            </header>
            <div className="flex-1 overflow-y-auto pb-24">
                <section className="grid grid-cols-2 gap-2 p-4">
                    <button type="button" onClick={()=>setView('ambient')} className="col-span-2 flex items-center gap-4 rounded-lg bg-[#176b5b] p-4 text-left text-white shadow-sm">
                        <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/12"><Captions size={24}/></span>
                        <span className="flex-1">
                            <span className="block text-base font-bold">{text.ambientTitle}</span>
                            <span className="mt-1 block text-[10px] leading-4 text-white/75">Sınıf, toplantı veya yaka mikrofonu ile canlı metin, kayıt ve dışa aktarım</span>
                        </span>
                        <ChevronRight size={18}/>
                    </button>
                    <button type="button" onClick={()=>setView('face')} className="col-span-2 flex items-center gap-4 rounded-lg border border-violet-200 bg-violet-50 p-4 text-left text-violet-900">
                        <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-white"><PanelsTopLeft size={23}/></span>
                        <span className="flex-1"><span className="block text-sm font-bold">Yüz yüze sohbet başlat</span><span className="mt-1 block text-[10px] leading-4 text-violet-700/80">Aynı masadaki iki kişi için ikiye ayrılmış yerel ekran</span></span>
                        <ChevronRight size={18}/>
                    </button>
                    <button type="button" onClick={()=>setView('emergency')} className="flex min-h-28 flex-col justify-between rounded-lg border border-red-200 bg-red-50 p-3 text-left text-red-800"><ShieldAlert size={22}/><span><span className="block text-sm font-bold">Acil Kart</span><span className="text-[9px]">Tek dokunuşla büyük yazı</span></span></button>
                    <button type="button" onClick={()=>setShowContacts(true)} className="flex min-h-28 flex-col justify-between rounded-lg border border-sky-200 bg-sky-50 p-3 text-left text-sky-800"><ContactRound size={22}/><span><span className="block text-sm font-bold">Hızlı Bağlantı</span><span className="text-[9px]">Yakın veya tercüman ara</span></span></button>
                </section>

                {captionSessions.length>0&&<section className="mt-2 px-4">
                    <div className="mb-2 flex items-center gap-2"><History size={17} className="eary-brand"/><h2 className="text-sm font-bold">Ortam dinleme geçmişi</h2></div>
                    {captionSessions.slice(0,4).map(session=><div key={session.id} className="flex items-center gap-3 border-b eary-line py-3"><Captions size={17} className="eary-muted"/><div className="flex-1"><p className="text-xs font-semibold">{session.title}</p><p className="eary-muted text-[9px]">{new Date(session.createdAt).toLocaleString('tr-TR')} · {session.captions.length} paragraf ·</p></div></div>)}
                </section>}

                <div className="mx-4 mt-5 rounded-lg border eary-line p-3">
                    <div className="flex gap-3"><Sparkles size={18} className="eary-brand shrink-0"/><p className="eary-muted text-[10px] leading-4">Ortam dinleme konuşmayı paragraflar hâlinde canlı metne çevirir; ham ses kaydı yapmaz.</p></div>
                </div>
            </div>
            <nav className="eary-shell absolute bottom-0 left-0 right-0 grid grid-cols-3 border-t eary-line px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2">
                <button type="button" className="eary-brand flex flex-col items-center gap-1 text-[10px] font-bold"><Sparkles size={20}/>{text.accessibility}</button>
                <button type="button" onClick={onOpenChats} className="eary-muted flex flex-col items-center gap-1 text-[10px] font-semibold"><MessageCircle size={20}/>{text.navChats}</button>
                <button type="button" onClick={onOpenSettings} className="eary-muted flex flex-col items-center gap-1 text-[10px] font-semibold"><UserRound size={20}/>{text.profile}</button>
            </nav>
            {showContacts&&<div className="absolute inset-0 z-50 flex items-end bg-black/35" onClick={()=>setShowContacts(false)}>
                <section className="eary-shell w-full rounded-t-xl p-4" onClick={event=>event.stopPropagation()}>
                    <div className="mb-4 flex items-center justify-between"><div><h2 className="font-bold">Hızlı bağlantı</h2><p className="eary-muted text-[10px]">Yakınınız veya işaret dili tercümanı</p></div><button type="button" onClick={()=>setShowContacts(false)} className="eary-soft eary-muted flex h-9 w-9 items-center justify-center rounded-lg"><X size={18}/></button></div>
                    <div className="max-h-48 overflow-y-auto">{quickContacts.map(contact=><div key={contact.id} className="flex items-center gap-3 border-b eary-line py-3"><ContactRound size={18} className="eary-brand"/><p className="flex-1 text-sm font-semibold">{contact.name}</p><a href={`tel:${contact.phone}`} className="eary-brand-bg rounded-lg px-3 py-2 text-xs font-bold">Ara</a></div>)}</div>
                    <div className="mt-4 grid grid-cols-[1fr_1fr_auto] gap-2"><input value={newContact.name} onChange={event=>setNewContact(current=>({...current,name:event.target.value}))} placeholder="Ad" className="eary-input min-w-0 rounded-lg border px-3 py-2 text-xs"/><input value={newContact.phone} onChange={event=>setNewContact(current=>({...current,phone:event.target.value}))} placeholder="Telefon" type="tel" className="eary-input min-w-0 rounded-lg border px-3 py-2 text-xs"/><button type="button" onClick={addContact} className="eary-brand-bg rounded-lg px-3 text-xs font-bold">Ekle</button></div>
                </section>
            </div>}
        </main>
    );
}
