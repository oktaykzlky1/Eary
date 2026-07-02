import { useEffect, useRef, useState } from 'react';
import {
    AlertTriangle, ArrowLeft, BellRing, Captions,
    Check, ChevronRight, CircleHelp, ContactRound, DoorOpen, Flame,
    FileText, HeartPulse, History, Languages, MessageCircle, Mic, PanelsTopLeft, Phone, Plus, Save, ShieldAlert,
    Sparkles, Star, StopCircle, Trash2, UserRound, Volume2, X
} from 'lucide-react';
import { getDuoSpeechRecognizer } from '../utils/speech';
import { requestNotificationPermission, scheduleNotification } from '../utils/notifications';
import { correctTranscription } from '../utils/autocorrect';
import { SUPPORTED_LANGUAGES, getInitialAppLanguage, getLanguageLabel } from '../utils/language';
import { Capacitor, registerPlugin } from '@capacitor/core';

const EnvironmentalSound = registerPlugin('EnvironmentalSound');
const VoiceSettings = registerPlugin('VoiceSettings');

const SOUND_TYPES = [
    ['doorbell', 'Kapı zili', DoorOpen], ['alarm', 'Yangın/duman alarmı', Flame],
    ['baby', 'Bebek ağlaması', HeartPulse], ['horn', 'Araç kornası', AlertTriangle],
    ['phone', 'Telefon zili', Phone], ['dog', 'Köpek havlaması', BellRing]
];

const MODE_CONFIG = {
    general: {
        title: 'Genel', icon: Captions, color: '#176b5b', prompt: 'Konuşmayı okunabilir canlı metne çevir',
        speakers: ['Konuşmacı'],
        groups: [
            { title: 'Önemli noktalar', keywords: ['önemli', 'unutmayın', 'dikkat', 'gerekli', 'zorunlu'] },
            { title: 'Tarihler ve saatler', keywords: ['bugün', 'yarın', 'haftaya', 'tarih', 'saat', 'son gün'] },
            { title: 'Yapılacaklar', keywords: ['yapın', 'hazırlayın', 'gönderin', 'getirin', 'kontrol edin'] }
        ],
        phrases: ['Tekrar eder misiniz?', 'Biraz yavaş konuşabilir misiniz?', 'Bunu yazılı olarak paylaşır mısınız?']
    }
};

const LISTENING_IMPORTANT_HINTS = [
    'önemli', 'unutmayın', 'dikkat', 'sınav', 'ödev', 'teslim', 'son gün', 'yarın', 'haftaya',
    'randevu', 'kontrol', 'ilaç', 'doz', 'belge', 'evrak', 'ücret', 'ödeme', 'karar', 'görev',
    'zorunlu', 'yapmanız gerekiyor', 'getirin', 'gönderin', 'hazırlayın'
];

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

const SUMMARY_MIN_WORDS = 40;
const SUMMARY_MIN_SENTENCES = 2;

const addLightPunctuation = text => {
    let next = String(text || '')
        .replace(/\s+/g, ' ')
        .replace(/\s+([.,!?])/g, '$1')
        .trim();
    if (!next) return '';
    next = next.replace(/\b(ancak|fakat|ama|çünkü|bu yüzden|bu nedenle|sonra|ardından|buna rağmen|özellikle|sonuç olarak)\b/giu, match => `. ${match.toLocaleLowerCase('tr-TR')}`);
    next = next.replace(/\s*\.\s*/g, '. ').replace(/\s+/g, ' ').trim();
    next = next.replace(/(^|[.!?]\s+)(\p{L})/gu, (_, prefix, letter) => `${prefix}${letter.toLocaleUpperCase('tr-TR')}`);
    if (!/[.!?]$/.test(next)) next += '.';
    return next;
};

const cleanListeningText = (text, language = 'tr-TR') => {
    let next = correctTranscription(String(text || ''), language)
        .replace(/\s+/g, ' ')
        .replace(/\b(\p{L}{2,})\s+\1\b/giu, '$1')
        .trim();
    LISTENING_REPLACEMENTS.forEach(([pattern, replacement]) => {
        next = next.replace(pattern, replacement);
    });
    next = next.replace(/\s+([.,!?])/g, '$1');
    return addLightPunctuation(next);
};

const isImportantListeningText = (text, contextConfig) => {
    const value = String(text || '').toLocaleLowerCase('tr-TR');
    const contextKeywords = contextConfig.groups.flatMap(group => group.keywords);
    return [...LISTENING_IMPORTANT_HINTS, ...contextKeywords].some(keyword => value.includes(keyword));
};

const summarizeListeningLines = lines => {
    if (!lines.length) return 'Henüz özetlenecek konuşma yok.';
    return buildListeningSummary(lines);
};

const countWords = value => String(value || '').trim().split(/\s+/).filter(Boolean).length;

const countSentences = value => String(value || '').split(/[.!?]+/).map(item => item.trim()).filter(Boolean).length;

const shouldOfferSummary = value => countWords(value) >= SUMMARY_MIN_WORDS || countSentences(value) >= SUMMARY_MIN_SENTENCES;

const SUMMARY_FILLERS = [
    'yani', 'hani', 'şey', 'şimdi', 'aslında', 'böyle', 'biraz', 'tamam', 'evet', 'ıı', 'eee'
];

const splitListeningSentences = lines => lines
    .flatMap(line => String(line.text || '').split(/(?<=[.!?])\s+|[\n\r]+/).map(sentence => ({ sentence, line })))
    .map(({ sentence, line }) => ({
        text: sentence
            .replace(/\s+/g, ' ')
            .replace(new RegExp(`\\b(${SUMMARY_FILLERS.join('|')})\\b`, 'giu'), '')
            .replace(/\s+/g, ' ')
            .replace(/\s+([.,!?])/g, '$1')
            .trim(),
        line
    }))
    .filter(item => item.text.length > 8);

const SUMMARY_STOP_WORDS = new Set([
    've', 'veya', 'ile', 'için', 'gibi', 'çok', 'daha', 'bir', 'bu', 'şu', 'o', 'da', 'de',
    'mi', 'mı', 'mu', 'mü', 'ise', 'olan', 'olarak', 'kadar', 'tüm', 'bütün', 'şey'
]);

const importantTermsFrom = text => String(text || '')
    .split(/\s+/)
    .map(word => word.replace(/[^\p{L}\p{N}]/gu, '').trim())
    .filter(word => word.length >= 4 && !SUMMARY_STOP_WORDS.has(word.toLocaleLowerCase('tr-TR')))
    .filter((word, index, list) => list.findIndex(item => item.toLocaleLowerCase('tr-TR') === word.toLocaleLowerCase('tr-TR')) === index)
    .slice(0, 3)
    .join(' ');

const compactClause = text => {
    const clean = String(text || '').replace(/[.!?]+$/, '').trim();
    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length <= 16) return clean;
    return words.slice(0, 16).join(' ');
};

const sentenceSummaryScore = (text, line, index, total) => {
    const lower = text.toLocaleLowerCase('tr-TR');
    const hasNumber = /\d/.test(text);
    const hasAction = /(gerekiyor|gerekir|yapın|yapmanız|hazırlayın|gönderin|getirin|unutmayın|kontrol|teslim|randevu|ödeme|karar|son gün|zorunlu)/i.test(lower);
    const hasTime = /(bugün|yarın|haftaya|saat|tarih|pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar)/i.test(lower);
    const keywordScore = LISTENING_IMPORTANT_HINTS.reduce((score, keyword) => score + (lower.includes(keyword) ? 2 : 0), 0);
    const lengthScore = text.length > 36 && text.length < 180 ? 1 : 0;
    const recencyScore = total ? index / total : 0;
    return keywordScore + (line.important ? 4 : 0) + (hasAction ? 3 : 0) + (hasTime ? 2 : 0) + (hasNumber ? 1 : 0) + lengthScore + recencyScore;
};

const compactSummarySentence = text => {
    const clean = String(text || '').replace(/[.!?]+$/, '').trim();
    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length <= 18) return clean;
    return `${words.slice(0, 18).join(' ')}...`;
};

const buildListeningSummary = (lines, focusId = null) => {
    if (!lines.length) return 'Henüz özetlenecek konuşma yok.';
    const usableLines = focusId ? lines.filter(line => Number(line.id) <= Number(focusId)) : lines;
    const sentenceItems = splitListeningSentences(usableLines);
    if (!sentenceItems.length) return 'Konuşma metni henüz yeterince net değil.';
    const allText = usableLines.map(line => line.text).join(' ');
    if (!shouldOfferSummary(allText)) return 'Bu metin kısa olduğu için ayrıca özet gerektirmiyor.';

    const focusIndex = focusId ? sentenceItems.findIndex(item => item.line.id === focusId) : -1;
    const semanticGroups = [
        { type: 'purpose', pattern: /(amaç|hedef|istem|plan|fethet|almak|ulaşmak|kurmak|hazırlamak)/i },
        { type: 'obstacle', pattern: /(ancak|fakat|ama|zorland|geçemedi|kısıtlı|engel|sorun|eksik|risk|rahatça|karşısına)/i },
        { type: 'tool', pattern: /(top|araç|teçhizat|sistem|yöntem|çözüm|kullanım|rol|önem|kritik)/i },
        { type: 'result', pattern: /(sonuç|zafer|kazandır|değiştir|başar|tamamlan|sağladı|getirdi|oldu)/i }
    ].map(group => ({
        ...group,
        item: sentenceItems.find(item => group.pattern.test(item.text.toLocaleLowerCase('tr-TR')))
    })).filter(group => group.item);

    if (semanticGroups.length >= 2) {
        const linesByType = [];
        const seenTypes = new Set();
        semanticGroups.forEach(group => {
            if (seenTypes.has(group.type)) return;
            seenTypes.add(group.type);
            const subject = importantTermsFrom(group.item.text);
            const clause = compactClause(group.item.text);
            if (group.type === 'purpose') linesByType.push(`${subject || 'Konuşmanın ana konusu'}, ${clause.toLocaleLowerCase('tr-TR')}.`);
            if (group.type === 'obstacle') linesByType.push(`Ana zorluk: ${clause}.`);
            if (group.type === 'tool') linesByType.push(`Kritik unsur: ${clause}.`);
            if (group.type === 'result') linesByType.push(`Sonuç: ${clause}.`);
        });
        if (linesByType.length >= 2) return linesByType.slice(0, 4).map(item => `• ${item}`).join('\n');
    }

    const ranked = sentenceItems
        .map((item, index) => ({
            ...item,
            index,
            score: sentenceSummaryScore(item.text, item.line, index, sentenceItems.length) + (focusIndex >= 0 && Math.abs(index - focusIndex) <= 1 ? 2 : 0)
        }))
        .sort((a, b) => b.score - a.score || b.index - a.index);

    const picked = [];
    const seen = new Set();
    ranked.forEach(item => {
        const key = item.text.toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        if (!key || seen.has(key)) return;
        if (picked.some(existing => existing.key.includes(key) || key.includes(existing.key))) return;
        seen.add(key);
        picked.push({ key, text: compactSummarySentence(item.text), index: item.index });
    });

    const selected = picked
        .slice(0, focusId ? 3 : 4)
        .sort((a, b) => a.index - b.index)
        .map(item => item.text);

    if (!selected.length) return 'Bu bölümde özetlenecek belirgin bir nokta yakalanmadı.';
    return selected.map(item => `• ${item}`).join('\n');
};

const loadJson = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; }
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

const normalizeSensitiveName = value => String(value || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/\u0131/g, 'i').replace(/\u015f/g, 's').replace(/\u011f/g, 'g')
    .replace(/\u00fc/g, 'u').replace(/\u00f6/g, 'o').replace(/\u00e7/g, 'c')
    .replace(/[^a-z0-9]/g, '');

const nameEditDistance = (left, right) => {
    const row = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let i = 1; i <= left.length; i += 1) {
        let previous = row[0]; row[0] = i;
        for (let j = 1; j <= right.length; j += 1) {
            const old = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (left[i - 1] === right[j - 1] ? 0 : 1));
            previous = old;
        }
    }
    return row[right.length];
};

const containsSensitiveTurkishName = (transcript, name) => {
    const target = normalizeSensitiveName(name);
    if (!target) return false;
    const words = String(transcript || '').split(/\s+/);
    return words.some((word, index) => {
        const candidate = normalizeSensitiveName(word);
        if (candidate === target) return true;
        if (target.length >= 4 && Math.abs(candidate.length - target.length) <= 1 && nameEditDistance(candidate, target) <= 1) return true;
        const pair = normalizeSensitiveName(`${word}${words[index + 1] || ''}`);
        return target.length >= 5 && nameEditDistance(pair, target) <= 1;
    });
};

function EnvironmentMonitor({ onBack }) {
    const [settings, setSettings] = useState(() => loadJson('eary_environment_settings', { enabled: [], customLabel: '', nameEnabled: false, nameKeyword: '', vibration: true, screenFlash: true, watch: true }));
    const [nameDraft, setNameDraft] = useState(() => loadJson('eary_environment_settings', {}).nameKeyword || '');
    const [nameSaved, setNameSaved] = useState(false);
    const [customProfiles, setCustomProfiles] = useState(() => loadJson('eary_custom_sounds', []));
    const [customDraft, setCustomDraft] = useState('');
    const [trainingId, setTrainingId] = useState(null);
    const [monitoring, setMonitoring] = useState(false);
    const [status, setStatus] = useState('Kapalı');
    const [events, setEvents] = useState(() => loadJson('eary_environment_events', []));
    const [flash, setFlash] = useState(false);
    const streamRef = useRef(null);
    const audioContextRef = useRef(null);
    const intervalRef = useRef(null);
    const recognitionRef = useRef(null);
    const lastAlertRef = useRef(0);

    useEffect(() => { localStorage.setItem('eary_environment_settings', JSON.stringify(settings)); }, [settings]);
    useEffect(() => { localStorage.setItem('eary_custom_sounds', JSON.stringify(customProfiles)); }, [customProfiles]);
    useEffect(() => {
        if (Capacitor.isNativePlatform()) {
            EnvironmentalSound.status().then(result => {
                if (result.active) {
                    setMonitoring(true);
                    setStatus('Seçilen sesler ekran kilitliyken de cihazda izleniyor');
                }
            }).catch(console.error);
        }
        return () => {
            if (!Capacitor.isNativePlatform()) stopMonitoring();
        };
    }, []);

    const alertUser = async (type, label, confidence) => {
        if (Date.now() - lastAlertRef.current < 7000) return;
        lastAlertRef.current = Date.now();
        const item = { id: Date.now(), type, label, confidence, timestamp: Date.now() };
        setEvents(current => {
            const next = [item, ...current].slice(0, 30);
            localStorage.setItem('eary_environment_events', JSON.stringify(next));
            return next;
        });
        if (settings.vibration && navigator.vibrate) navigator.vibrate(type === 'alarm' ? [500, 150, 500, 150, 700] : [250, 120, 250]);
        if (settings.screenFlash) { setFlash(true); setTimeout(() => setFlash(false), 1400); }
        if (settings.watch) await scheduleNotification('Eary Ses Uyarısı', `${label} · Güven %${Math.round(confidence * 100)}`);
    };

    const stopMonitoring = () => {
        if (Capacitor.isNativePlatform()) EnvironmentalSound.stop().catch(console.error);
        clearInterval(intervalRef.current);
        recognitionRef.current?.abort?.();
        streamRef.current?.getTracks?.().forEach(track => track.stop());
        audioContextRef.current?.close?.();
        intervalRef.current = null; recognitionRef.current = null; streamRef.current = null; audioContextRef.current = null;
        setMonitoring(false); setStatus('Kapalı');
    };

    const startMonitoring = async () => {
        const enabledCustom = customProfiles.filter(profile => profile.enabled && profile.samples > 0);
        if (!settings.enabled.length && !enabledCustom.length && !(settings.nameEnabled && settings.nameKeyword.trim())) { setStatus('En az bir ses veya isim seçin'); return; }
        try {
            await requestNotificationPermission();
            if (Capacitor.isNativePlatform() && (settings.enabled.length || enabledCustom.length)) {
                const enabled = [...settings.enabled, ...enabledCustom.map(profile => `custom:${profile.id}`)];
                await EnvironmentalSound.start({ enabled: enabled.join(',') });
                setMonitoring(true);
                setStatus('Seçilen sesler ekran kilitliyken de cihazda izleniyor');
                return;
            }
            const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
            streamRef.current = stream;
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            const context = new AudioContextClass();
            await context.resume();
            audioContextRef.current = context;
            const analyser = context.createAnalyser(); analyser.fftSize = 1024;
            context.createMediaStreamSource(stream).connect(analyser);
            const bins = new Uint8Array(analyser.frequencyBinCount);
            let loudFrames = 0; let tonalFrames = 0; let noiseFloor = 8;
            intervalRef.current = setInterval(() => {
                analyser.getByteFrequencyData(bins);
                const average = bins.reduce((sum, value) => sum + value, 0) / bins.length;
                const high = bins.slice(Math.floor(bins.length * 0.45)).reduce((sum, value) => sum + value, 0) / Math.ceil(bins.length * 0.55);
                const low = bins.slice(0, Math.floor(bins.length * 0.2)).reduce((sum, value) => sum + value, 0) / Math.floor(bins.length * 0.2);
                if (average < noiseFloor + 7) noiseFloor = (noiseFloor * 0.96) + (average * 0.04);
                const isLoud = average > Math.max(16, noiseFloor + 9);
                loudFrames = isLoud ? loudFrames + 1 : Math.max(0, loudFrames - 1);
                tonalFrames = high > average * 1.22 ? tonalFrames + 1 : Math.max(0, tonalFrames - 1);
                if (loudFrames >= 5 && tonalFrames >= 4 && settings.enabled.includes('alarm')) { alertUser('alarm', 'Alarm benzeri yüksek öncelikli ses', 0.72); loudFrames = 0; tonalFrames = 0; }
                else if (loudFrames >= 4 && low > high * 1.35 && settings.enabled.includes('horn')) { alertUser('horn', 'Korna benzeri güçlü ses', 0.64); loudFrames = 0; }
                else if (loudFrames >= 3 && tonalFrames >= 2 && (settings.enabled.includes('doorbell') || settings.enabled.includes('phone'))) { alertUser('bell', 'Zil benzeri ses', 0.58); loudFrames = 0; tonalFrames = 0; }
                else if (loudFrames >= 6 && high > low * 1.08 && settings.enabled.includes('baby')) { alertUser('baby', 'Bebek ağlamasına benzeyen ses', 0.52); loudFrames = 0; }
                else if (loudFrames >= 3 && low > average * 1.12 && settings.enabled.includes('dog')) { alertUser('dog', 'Havlamaya benzeyen kısa ses', 0.49); loudFrames = 0; }
                else if (loudFrames >= 5 && settings.enabled.includes('custom')) { alertUser('custom', `${settings.customLabel.trim() || 'Özel'} sese benzeyen güçlü ses`, 0.42); loudFrames = 0; }
            }, 240);

            if (settings.nameEnabled && settings.nameKeyword.trim()) {
                const recognizer = getDuoSpeechRecognizer('tr-TR', (finalText, interimText) => {
                    if (containsSensitiveTurkishName(`${finalText || ''} ${interimText || ''}`, settings.nameKeyword)) alertUser('name', `Birisi “${settings.nameKeyword.trim()}” dedi`, 0.85);
                }, () => {}, error => setStatus(`İsim algılama kullanılamadı: ${String(error?.message || error)}`));
                recognitionRef.current = recognizer;
                Promise.resolve(recognizer?.start?.()).catch(error => {
                    setStatus(`Çevresel sesler dinleniyor · isim algılama kullanılamadı: ${String(error?.message || error)}`);
                });
            }
            setMonitoring(true);
            setStatus(settings.nameEnabled ? 'Çevresel sesler ve isminiz dinleniyor' : 'Çevresel sesler dinleniyor');
        } catch (error) { setStatus(error.message || 'Mikrofon açılamadı'); stopMonitoring(); }
    };

    const toggleSound = id => setSettings(current => ({ ...current, enabled: current.enabled.includes(id) ? current.enabled.filter(item => item !== id) : [...current.enabled, id] }));
    const saveName = () => {
        const nameKeyword = nameDraft.trim();
        setSettings(current => ({ ...current, nameKeyword }));
        setNameSaved(true);
        setTimeout(() => setNameSaved(false), 1800);
    };

    const addCustomProfile = () => {
        const label = customDraft.trim();
        if (!label || customProfiles.length >= 10) return;
        setCustomProfiles(current => [...current, { id: `${Date.now()}`, label, samples: 0, enabled: true }]);
        setCustomDraft('');
    };
    const trainCustomProfile = async profile => {
        if (!Capacitor.isNativePlatform()) { setStatus('Ozel ses ogretme Android uygulamasinda kullanilir'); return; }
        stopMonitoring();
        setTrainingId(profile.id);
        setStatus(`${profile.label} icin sesi 4-5 saniye calin`);
        try {
            await EnvironmentalSound.train({ profileId: profile.id, label: profile.label });
            setTimeout(() => {
                const timer = setInterval(async () => {
                    const result = await EnvironmentalSound.status();
                    setStatus(result.trainingMessage || 'Ses ornegi isleniyor');
                    if (!result.training) {
                        clearInterval(timer);
                        setTrainingId(null);
                        if (String(result.trainingMessage).includes('kaydedildi')) {
                            setCustomProfiles(current => current.map(item => item.id === profile.id ? { ...item, samples: item.samples + 1 } : item));
                        }
                    }
                }, 700);
            }, 900);
        } catch (error) {
            setTrainingId(null);
            setStatus(error.message || 'Ses ornegi baslatilamadi');
        }
    };
    const removeCustomProfile = profile => {
        EnvironmentalSound.removeProfile({ profileId: profile.id }).catch(() => {});
        setCustomProfiles(current => current.filter(item => item.id !== profile.id));
    };

    return <main className="eary-shell relative mx-auto flex h-screen w-full max-w-md flex-col overflow-hidden sm:h-[800px] sm:rounded-xl sm:border sm:eary-line">{flash && <div className="pointer-events-none absolute inset-0 z-50 animate-pulse border-[18px] border-amber-400 bg-amber-200/35" />}<header className="eary-ios-safe-header flex items-center gap-3 border-b eary-line px-4 pb-3"><button type="button" onClick={onBack} className="eary-soft eary-muted flex h-10 w-10 items-center justify-center rounded-lg"><ArrowLeft size={20} /></button><div><h1 className="font-bold">Çevresel Ses Uyarıları</h1><p className="eary-muted text-[10px]">Yalnız siz açtığınızda mikrofon kullanılır</p></div></header><div className="flex-1 overflow-y-auto pb-6"><section className="px-4 py-4"><div className={`rounded-lg border px-4 py-3 ${monitoring ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'eary-line eary-soft'}`}><div className="flex items-center gap-3"><span className={`h-3 w-3 rounded-full ${monitoring ? 'animate-pulse bg-emerald-500' : 'bg-slate-400'}`} /><div className="flex-1"><p className="text-sm font-bold">{monitoring ? 'Aktif' : 'Kapalı'}</p><p className="text-[10px] opacity-75">{status}</p></div><button type="button" onClick={monitoring ? stopMonitoring : startMonitoring} className={`rounded-lg px-4 py-2 text-xs font-bold ${monitoring ? 'bg-rose-100 text-rose-700' : 'eary-brand-bg'}`}>{monitoring ? 'Durdur' : 'Başlat'}</button></div></div></section><p className="eary-muted px-4 pb-2 text-[10px] font-bold uppercase">İzlenecek sesler</p><section className="grid grid-cols-2 gap-2 px-4">{SOUND_TYPES.map(([id,label,Icon]) => <button key={id} type="button" onClick={() => toggleSound(id)} className={`flex min-h-20 items-center gap-3 rounded-lg border p-3 text-left ${settings.enabled.includes(id) ? 'border-[var(--brand)] eary-brand-soft' : 'eary-line eary-shell'}`}><Icon size={20} /><span className="text-xs font-semibold">{label}</span>{settings.enabled.includes(id) && <Check size={14} className="ml-auto" />}</button>)}</section><section className="mt-5 border-y eary-line px-4 py-4"><div className="mb-3 flex items-center justify-between"><div><h2 className="text-sm font-bold">Özel seslerim</h2><p className="eary-muted text-[10px]">Fırın, çamaşır makinesi veya size özel bir sesi öğretin</p></div><span className="eary-muted text-[10px]">{customProfiles.length}/10</span></div><div className="flex gap-2"><input value={customDraft} onChange={event=>setCustomDraft(event.target.value)} onKeyDown={event=>event.key==='Enter'&&addCustomProfile()} placeholder="Örn. Fırın zamanlayıcısı" className="eary-input min-w-0 flex-1 rounded-lg border px-3 py-2 text-xs"/><button type="button" onClick={addCustomProfile} disabled={!customDraft.trim()||customProfiles.length>=10} className="eary-brand-bg flex h-9 w-9 items-center justify-center rounded-lg disabled:opacity-40" title="Özel ses ekle"><Plus size={17}/></button></div>{customProfiles.length>0&&<div className="mt-3 space-y-2">{customProfiles.map(profile=><div key={profile.id} className="eary-soft flex items-center gap-2 rounded-lg border eary-line p-2.5"><input type="checkbox" checked={profile.enabled} disabled={!profile.samples} onChange={event=>setCustomProfiles(current=>current.map(item=>item.id===profile.id?{...item,enabled:event.target.checked}:item))} className="h-4 w-4 accent-[var(--brand)]"/><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{profile.label}</p><p className="eary-muted text-[9px]">{profile.samples?profile.samples+' örnek öğretildi':'Henüz örnek yok'}{profile.samples<3?' · En az 3 önerilir':''}</p></div><button type="button" onClick={()=>trainCustomProfile(profile)} disabled={trainingId!==null} className="eary-brand-soft rounded-md px-2.5 py-2 text-[9px] font-bold disabled:opacity-40">{trainingId===profile.id?'Dinliyor...':profile.samples?'Tekrar öğret':'Öğret'}</button><button type="button" onClick={()=>removeCustomProfile(profile)} className="eary-muted flex h-8 w-8 items-center justify-center rounded-md" title="Özel sesi sil"><Trash2 size={14}/></button></div>)}</div>}</section><section className="mt-5 border-y eary-line px-4 py-4"><label className="flex items-center gap-3"><input type="checkbox" checked={settings.nameEnabled} onChange={event => setSettings(current => ({...current,nameEnabled:event.target.checked}))} className="h-4 w-4 accent-[var(--brand)]" /><span className="text-sm font-semibold">İsmim söylendiğinde uyar</span></label>{settings.nameEnabled && <div className="mt-3 flex gap-2"><input value={nameDraft} onChange={event => {setNameDraft(event.target.value);setNameSaved(false);}} className="eary-input min-w-0 flex-1 rounded-lg border px-3 py-2.5 text-sm" placeholder="Örn. Aslı" /><button type="button" onClick={saveName} disabled={!nameDraft.trim()} className="eary-brand-bg flex h-10 w-10 shrink-0 items-center justify-center rounded-lg disabled:opacity-40" title="İsmi kaydet"><Check size={18}/></button></div>}{nameSaved&&<p className="mt-2 text-[10px] font-semibold text-emerald-600">İsim kaydedildi</p>}</section><p className="eary-muted px-4 pb-2 pt-5 text-[10px] font-bold uppercase">Uyarı biçimi</p><section className="px-4">{[['vibration','Güçlü titreşim'],['screenFlash','Ekran ışığı'],['watch','Telefon ve akıllı saat bildirimi']].map(([key,label]) => <label key={key} className="flex items-center gap-3 border-b eary-line py-3"><input type="checkbox" checked={settings[key]} onChange={event => setSettings(current => ({...current,[key]:event.target.checked}))} className="h-4 w-4 accent-[var(--brand)]" /><span className="text-sm">{label}</span></label>)}</section>{events.length > 0 && <section className="mt-5 px-4"><div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-bold">Son uyarılar</h2><button type="button" onClick={() => {setEvents([]);localStorage.removeItem('eary_environment_events');}} className="text-[10px] font-semibold text-rose-600">Temizle</button></div>{events.slice(0,6).map(event => <div key={event.id} className="flex items-center gap-3 border-b eary-line py-2.5"><BellRing size={17} className="eary-brand" /><div className="flex-1"><p className="text-xs font-semibold">{event.label}</p><p className="eary-muted text-[10px]">{new Date(event.timestamp).toLocaleTimeString('tr-TR')} · Güven %{Math.round(event.confidence*100)}</p></div></div>)}</section>}<div className="mx-4 mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[10px] leading-4 text-amber-900">Bu özellik yardımcı bir erken uyarıdır; sertifikalı yangın, güvenlik veya bebek izleme cihazlarının yerine geçmez. Ham ses kaydedilmez veya sunucuya gönderilmez.</div></div></main>;
}

function AmbientListeningTool({ onBack }) {
    const [captions, setCaptions] = useState([]);
    const [interim, setInterim] = useState('');
    const [listening, setListening] = useState(false);
    const [saved, setSaved] = useState(false);
    const [summaryOpen, setSummaryOpen] = useState(false);
    const [summaryText, setSummaryText] = useState('');
    const [lineSummaries, setLineSummaries] = useState({});
    const [contextId, setContextId] = useState(() => localStorage.getItem('eary_ambient_context') || 'general');
    const [language, setLanguage] = useState(() => localStorage.getItem('eary_ambient_language') || getInitialAppLanguage());
    const recognizerRef = useRef(null);
    const scrollRef = useRef(null);
    const desiredListeningRef = useRef(false);
    const interimRef = useRef('');
    const contextConfig = MODE_CONFIG[contextId] || MODE_CONFIG.general;
    const keywords = [...new Set([...LISTENING_IMPORTANT_HINTS, ...contextConfig.groups.flatMap(group => group.keywords)])];
    const importantLines = captions.filter(line => line.important);
    const groupedCaptions = contextConfig.groups.map(group => ({
        ...group,
        lines: captions.filter(line => group.keywords.some(keyword => line.text.toLocaleLowerCase('tr-TR').includes(keyword)))
    }));
    const runAfterUiPaint = callback => {
        requestAnimationFrame(() => {
            setTimeout(callback, 30);
        });
    };

    useEffect(() => () => {
        desiredListeningRef.current = false;
        recognizerRef.current?.abort?.();
    }, []);
    useEffect(() => localStorage.setItem('eary_ambient_context', contextId), [contextId]);
    useEffect(() => localStorage.setItem('eary_ambient_language', language), [language]);
    useEffect(() => {
        if (scrollRef.current && !summaryOpen) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [captions, interim, summaryOpen]);

    const appendCaption = (rawText, confidence) => {
        const now = Date.now();
        const clean = cleanListeningText(rawText, language);
        if (!clean) return;
        const important = isImportantListeningText(clean, contextConfig);
        setCaptions(current => {
            const last = current[current.length - 1];
            const shouldJoin = last && now - last.timestamp < 4500 && !important && !last.important && clean.length < 120;
            if (shouldJoin) {
                const mergedText = cleanListeningText(`${last.text} ${clean}`, language);
                return [...current.slice(0, -1), {
                    ...last,
                    text: mergedText,
                    timestamp: now,
                    uncertain: last.uncertain || (confidence != null && confidence < 0.62)
                }];
            }
            return [...current, {
                id: now,
                text: clean,
                rawText: rawText.trim(),
                timestamp: now,
                important,
                uncertain: confidence != null && confidence < 0.62
            }];
        });
    };

    const commitInterimCaption = () => {
        const pending = interimRef.current.trim();
        if (!pending) return;
        appendCaption(pending);
        interimRef.current = '';
        setInterim('');
    };

    const startListening = async () => {
        desiredListeningRef.current = true;
        const recognizer = getDuoSpeechRecognizer(language, (finalText, interimText, confidence) => {
            const nextInterim = interimText ? cleanListeningText(interimText, language).replace(/[.!?]$/, '') : '';
            interimRef.current = nextInterim;
            setInterim(nextInterim);
            if (finalText?.trim()) {
                appendCaption(finalText.trim(), confidence);
                interimRef.current = '';
                setInterim('');
            }
        }, () => {
            setListening(false);
            commitInterimCaption();
            if (desiredListeningRef.current) {
                setTimeout(() => {
                    if (desiredListeningRef.current) startListening();
                }, 450);
            }
        }, error => {
            desiredListeningRef.current = false;
            setListening(false);
            setInterim(String(error?.message || 'Mikrofon başlatılamadı'));
            setTimeout(() => setInterim(''), 2400);
        });
        recognizerRef.current = recognizer;
        try {
            await recognizer.start();
            setListening(true);
        } catch (error) {
            setListening(false);
            setInterim(String(error?.message || 'Mikrofon başlatılamadı'));
            setTimeout(() => setInterim(''), 2400);
        }
    };

    const stopListening = () => {
        desiredListeningRef.current = false;
        commitInterimCaption();
        setListening(false);
        const recognizer = recognizerRef.current;
        runAfterUiPaint(() => {
            try {
                if (typeof recognizer?.abort === 'function') recognizer.abort();
                else recognizer?.stop?.();
            } catch (error) {
                console.warn('Ambient speech recognition could not be stopped:', error);
            }
        });
    };

    const toggleListening = () => {
        if (listening) stopListening();
        else startListening();
    };

    const refreshSummary = () => {
        setSummaryText(buildListeningSummary(captions));
        setSummaryOpen(true);
    };

    const summarizeLine = id => {
        setLineSummaries(current => ({
            ...current,
            [id]: buildListeningSummary(captions, id)
        }));
    };

    const canSummarizeUntil = id => shouldOfferSummary(captions
        .filter(line => Number(line.id) <= Number(id))
        .map(line => line.text)
        .join(' '));

    const canSummarizeSession = shouldOfferSummary(captions.map(line => line.text).join(' '));

    const saveSession = () => {
        const sessions = loadJson('eary_caption_sessions', []);
        const summary = groupedCaptions.map(group => ({ title: group.title, lineIds: group.lines.map(line => line.id) }));
        localStorage.setItem('eary_caption_sessions', JSON.stringify([{
            id: Date.now(),
            mode: 'ambient',
            title: 'Ortam Dinleme',
            context: contextId,
            language,
            createdAt: Date.now(),
            captions,
            summary,
            importantNotes: importantLines
        }, ...sessions].slice(0, 30)));
        setSaved(true);
        setTimeout(() => setSaved(false), 1800);
    };

    const toggleFlag = (id, key) => setCaptions(current => current.map(line => line.id === id ? { ...line, [key]: !line[key] } : line));
    const renderHighlighted = text => {
        const escaped = keywords.map(keyword => keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const pattern = escaped.length ? new RegExp(`(${escaped.join('|')})`, 'gi') : null;
        if (!pattern) return text;
        return text.split(pattern).map((part, index) => keywords.some(keyword => keyword.toLocaleLowerCase('tr-TR') === part.toLocaleLowerCase('tr-TR')) ? <mark key={index} className="rounded bg-amber-200 px-0.5">{part}</mark> : part);
    };

    return (
        <main className="eary-shell mx-auto flex h-screen w-full max-w-md flex-col overflow-hidden sm:h-[800px] sm:rounded-xl sm:border sm:eary-line">
            <header className="eary-ios-safe-header flex items-center gap-3 border-b eary-line px-4 pb-3">
                <button type="button" onClick={onBack} className="eary-soft eary-muted flex h-10 w-10 items-center justify-center rounded-lg"><ArrowLeft size={20} /></button>
                <span className="eary-brand-bg flex h-10 w-10 items-center justify-center rounded-lg"><Captions size={20} /></span>
                <div className="min-w-0 flex-1">
                    <h1 className="font-bold">Ortam Dinleme</h1>
                    <p className="eary-muted truncate text-[10px]">Canlı metin, anlam düzeltme, özet ve önemli notlar</p>
                </div>
                <button onClick={refreshSummary} disabled={!canSummarizeSession} className={`flex h-10 w-10 items-center justify-center rounded-lg disabled:opacity-30 ${summaryOpen ? 'eary-brand-bg' : 'eary-soft eary-brand'}`} title="Özetle"><Sparkles size={18}/></button>
                <button onClick={saveSession} disabled={!captions.length} className="eary-soft eary-brand flex h-10 w-10 items-center justify-center rounded-lg disabled:opacity-30" title="Oturumu kaydet">{saved ? <Check size={18}/> : <Save size={18}/>}</button>
            </header>

            <section className="grid grid-cols-2 gap-2 border-b eary-line px-4 py-3">
                <label className="block text-[10px] font-black uppercase eary-muted">Konuşma dili
                    <select value={language} onChange={event => setLanguage(event.target.value)} disabled={listening} className="eary-input mt-1 w-full rounded-lg border px-2 py-2 text-xs font-bold normal-case disabled:opacity-60">
                        {SUPPORTED_LANGUAGES.map(item => <option key={item.code} value={item.code}>{item.nativeLabel}</option>)}
                    </select>
                </label>
                <label className="block text-[10px] font-black uppercase eary-muted">Bağlam
                    <select value={contextId} onChange={event => setContextId(event.target.value)} className="eary-input mt-1 w-full rounded-lg border px-2 py-2 text-xs font-bold normal-case">
                        {Object.entries(MODE_CONFIG).map(([id, config]) => <option key={id} value={id}>{config.title}</option>)}
                    </select>
                </label>
            </section>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
                {summaryOpen ? (
                    <section className="space-y-3">
                        <div className="flex items-start justify-between gap-3">
                            <div><h2 className="text-lg font-bold">Canlı özet</h2><p className="eary-muted mt-1 text-[10px]">Mikrofon açıksa dinleme devam eder; bu panel konuşmayı durdurmaz.</p></div>
                            <button type="button" onClick={() => setSummaryOpen(false)} className="eary-soft eary-muted rounded-lg px-3 py-2 text-[10px] font-bold">Metne dön</button>
                        </div>
                        <article className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                            <h3 className="text-sm font-bold text-emerald-900">Kısa özet</h3>
                            <p className="mt-2 text-sm leading-6 text-emerald-950">{summaryText || summarizeListeningLines(captions)}</p>
                        </article>
                        <article className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                            <h3 className="text-sm font-bold text-amber-900">Önemli notlar</h3>
                            {importantLines.length ? importantLines.slice(-8).map(line => <p key={line.id} className="mt-2 text-xs leading-5 text-amber-900">• {line.text}</p>) : <p className="mt-2 text-[10px] text-amber-800">Henüz otomatik önemli not yakalanmadı.</p>}
                        </article>
                        {groupedCaptions.map(group => (
                            <article key={group.title} className="rounded-lg border eary-line p-3">
                                <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-bold">{group.title}</h3><span className="eary-brand-soft rounded-full px-2 py-0.5 text-[9px] font-bold">{group.lines.length}</span></div>
                                {group.lines.length ? group.lines.slice(-4).map(line => <p key={line.id} className="border-t eary-line py-2 text-xs leading-5">{line.text}</p>) : <p className="eary-muted text-[10px]">Bu başlıkta bilgi algılanmadı.</p>}
                            </article>
                        ))}
                    </section>
                ) : captions.length === 0 && !interim ? (
                    <div className="flex h-full flex-col items-center justify-center text-center">
                        <Captions size={36} className="eary-brand"/>
                        <h2 className="mt-3 font-bold">Canlı altyazı hazır</h2>
                        <p className="eary-muted mt-1 max-w-xs text-xs leading-5">Telefonu veya yaka mikrofonunu konuşan kişiye yaklaştırın. Mikrofon açık kaldığı sürece metin okunabilir paragraflara ayrılır.</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {captions.map(line => (
                            <article key={line.id} className={`rounded-lg border p-3 ${line.important ? 'border-amber-300 bg-amber-50' : 'eary-line eary-shell'}`}>
                                <div className="mb-2 flex items-center justify-between gap-2">
                                    <span className="eary-muted text-[9px] font-bold">{new Date(line.timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>
                                    <span className="flex gap-1">
                                        <button onClick={() => toggleFlag(line.id, 'uncertain')} title="Anlaşılmadı olarak işaretle" className={`flex h-7 w-7 items-center justify-center rounded-md ${line.uncertain ? 'bg-rose-100 text-rose-700' : 'eary-soft eary-muted'}`}><CircleHelp size={14}/></button>
                                        <button onClick={() => toggleFlag(line.id, 'important')} title="Önemli" className={`flex h-7 w-7 items-center justify-center rounded-md ${line.important ? 'bg-amber-200 text-amber-800' : 'eary-soft eary-muted'}`}><Star size={14} className={line.important ? 'fill-current' : ''}/></button>
                                    </span>
                                </div>
                                <p className={`text-[15px] font-semibold leading-7 ${line.uncertain ? 'decoration-rose-500 decoration-wavy underline' : ''}`}>{renderHighlighted(line.text)}</p>
                                {lineSummaries[line.id] && (
                                    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold leading-5 text-emerald-950 whitespace-pre-line">
                                        {lineSummaries[line.id]}
                                    </div>
                                )}
                                {canSummarizeUntil(line.id) && (
                                    <div className="mt-2 flex justify-end">
                                        <button type="button" onClick={() => summarizeLine(line.id)} className="eary-soft eary-brand flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[10px] font-bold" title="Bu bölüme kadar özetle">
                                            <Sparkles size={12}/> Özetle
                                        </button>
                                    </div>
                                )}
                            </article>
                        ))}
                        {interim && <div className="rounded-lg border border-dashed eary-line p-3 text-sm italic eary-muted">{interim}</div>}
                    </div>
                )}
            </div>

            <div className="border-t eary-line bg-[var(--surface)] px-3 py-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                        <p className="text-xs font-bold">{listening ? 'Mikrofon açık' : 'Mikrofon kapalı'}</p>
                        <p className="eary-muted truncate text-[10px]">{getLanguageLabel(language)} · {contextConfig.title} bağlamı</p>
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

const makeNoteTitle = text => {
    const words = String(text || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return 'Yeni sesli not';
    return words.slice(0, 20).join(' ');
};

function VoiceNotebook({ onBack }) {
    const [noteText, setNoteText] = useState(() => localStorage.getItem('eary_voice_note_draft') || '');
    const [interim, setInterim] = useState('');
    const [listening, setListening] = useState(false);
    const [saved, setSaved] = useState(false);
    const [language] = useState(() => localStorage.getItem('eary_notebook_language') || getInitialAppLanguage());
    const [targetLang, setTargetLang] = useState(() => localStorage.getItem('eary_notebook_target_lang') || 'tr-TR');
    const [showTranslationTools, setShowTranslationTools] = useState(false);
    const [translation, setTranslation] = useState('');
    const [translating, setTranslating] = useState(false);
    const noteTextareaRef = useRef(null);
    const recognizerRef = useRef(null);
    const interimRef = useRef('');
    const committedNoteRef = useRef(noteText.trim());
    const autoScrollNoteRef = useRef(true);
    const sessionRef = useRef(0);

    useEffect(() => localStorage.setItem('eary_voice_note_draft', noteText), [noteText]);
    useEffect(() => localStorage.setItem('eary_notebook_language', language), [language]);
    useEffect(() => localStorage.setItem('eary_notebook_target_lang', targetLang), [targetLang]);
    useEffect(() => () => recognizerRef.current?.abort?.(), []);

    const mergeNoteText = (base, draft) => [base.trim(), draft.trim()].filter(Boolean).join('\n\n');

    const keepNoteAtEnd = () => {
        requestAnimationFrame(() => {
            const node = noteTextareaRef.current;
            if (!node || !autoScrollNoteRef.current) return;
            node.scrollTop = node.scrollHeight;
            const end = node.value.length;
            try { node.setSelectionRange(end, end); } catch { /* textarea may not be focusable yet */ }
        });
    };

    const updateLiveDraft = rawText => {
        const clean = cleanListeningText(rawText, language);
        if (!clean) return;
        interimRef.current = clean;
        setInterim('');
        setNoteText(mergeNoteText(committedNoteRef.current, clean));
        setTranslation('');
        keepNoteAtEnd();
    };

    const commitLiveDraft = () => {
        const pending = interimRef.current.trim();
        if (pending) {
            committedNoteRef.current = mergeNoteText(committedNoteRef.current, pending);
            setNoteText(committedNoteRef.current);
        }
        interimRef.current = '';
        setInterim('');
        keepNoteAtEnd();
    };

    const stopListening = () => {
        const recognizer = recognizerRef.current;
        sessionRef.current += 1;
        setListening(false);
        commitLiveDraft();
        requestAnimationFrame(() => {
            setTimeout(() => {
                try {
                    if (typeof recognizer?.abort === 'function') recognizer.abort();
                    else recognizer?.stop?.();
                } catch (error) {
                    console.warn('Notebook speech recognition could not be stopped:', error);
                }
            }, 30);
        });
    };

    const startListening = async () => {
        const sessionId = sessionRef.current + 1;
        sessionRef.current = sessionId;
        committedNoteRef.current = noteText.trim();
        interimRef.current = '';
        setInterim('');
        setListening(false);
        const recognizer = getDuoSpeechRecognizer(language, (finalText, interimText) => {
            if (sessionRef.current !== sessionId) return;
            const nextInterim = interimText ? cleanListeningText(interimText, language).replace(/[.!?]$/, '') : '';
            if (nextInterim) updateLiveDraft(nextInterim);
            if (finalText?.trim()) {
                updateLiveDraft(finalText);
            }
        }, () => {
            if (sessionRef.current !== sessionId) return;
            setListening(false);
            commitLiveDraft();
        }, error => {
            if (sessionRef.current !== sessionId) return;
            setListening(false);
            setInterim(String(error?.message || 'Mikrofon başlatılamadı'));
            setTimeout(() => setInterim(''), 2400);
        });
        recognizerRef.current = recognizer;
        try {
            await recognizer.start();
            if (sessionRef.current === sessionId) setListening(true);
        } catch (error) {
            setListening(false);
            setInterim(String(error?.message || 'Mikrofon başlatılamadı'));
            setTimeout(() => setInterim(''), 2400);
        }
    };

    const toggleListening = () => {
        if (listening) stopListening();
        else startListening();
    };

    const saveNote = () => {
        if (!noteText.trim()) return;
        committedNoteRef.current = noteText.trim();
        const notes = loadJson('eary_voice_notes', []);
        const item = { id: Date.now(), title: makeNoteTitle(noteText), text: noteText.trim(), language, createdAt: Date.now() };
        localStorage.setItem('eary_voice_notes', JSON.stringify([item, ...notes].slice(0, 50)));
        setSaved(true);
        setTimeout(() => setSaved(false), 1800);
    };

    const translateNote = async () => {
        if (!showTranslationTools) {
            setShowTranslationTools(true);
            return;
        }
        if (!noteText.trim()) return;
        setTranslating(true);
        const result = await translateText(noteText, targetLang, language);
        setTranslation(result || 'Çeviri alınamadı.');
        setTranslating(false);
    };

    const clearNote = () => {
        setNoteText('');
        committedNoteRef.current = '';
        setInterim('');
        setTranslation('');
        setShowTranslationTools(false);
        localStorage.removeItem('eary_voice_note_draft');
    };

    const handleNoteScroll = event => {
        const node = event.currentTarget;
        autoScrollNoteRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
    };

    const handleNoteChange = event => {
        const next = event.target.value;
        setNoteText(next);
        if (!listening) committedNoteRef.current = next.trim();
        setTranslation('');
    };

    return (
        <main className="eary-shell relative mx-auto flex h-screen w-full max-w-md flex-col overflow-hidden sm:h-[800px] sm:rounded-xl sm:border sm:eary-line">
            <header className="eary-ios-safe-header flex items-center gap-3 border-b eary-line px-4 pb-3">
                <button type="button" onClick={onBack} className="eary-soft eary-muted flex h-10 w-10 items-center justify-center rounded-lg" aria-label="Geri dön"><ArrowLeft size={20} /></button>
                <span className="eary-brand-bg flex h-10 w-10 items-center justify-center rounded-lg"><FileText size={20} /></span>
                <div className="min-w-0 flex-1">
                    <h1 className="font-bold">Not Defteri</h1>
                    <p className="eary-muted truncate text-[10px]">Ders, toplantı veya günlük notlar için bas-konuş</p>
                </div>
                <button type="button" onClick={saveNote} disabled={!noteText.trim()} className="eary-soft eary-brand flex h-10 w-10 items-center justify-center rounded-lg disabled:opacity-30" title="Notu kaydet">{saved ? <Check size={18}/> : <Save size={18}/>}</button>
            </header>

            <section className="border-b eary-line px-4 py-3">
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <button type="button" onClick={translateNote} disabled={!noteText.trim() || translating} className="eary-soft eary-brand flex min-h-10 items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-bold disabled:opacity-30"><Languages size={15}/>{translating ? 'Çevriliyor' : 'Çevir'}</button>
                    <button type="button" onClick={saveNote} disabled={!noteText.trim()} className="eary-soft eary-brand flex min-h-10 items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-bold disabled:opacity-30"><Save size={15}/>Kaydet</button>
                    <button type="button" onClick={clearNote} disabled={!noteText.trim() && !interim} className="eary-soft eary-muted flex min-h-10 items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-bold disabled:opacity-30"><Trash2 size={15}/>Temizle</button>
                </div>
                {showTranslationTools && (
                    <div className="mt-3 flex items-end gap-2 rounded-lg border eary-line p-3">
                        <label className="min-w-0 flex-1 text-[10px] font-black uppercase eary-muted">Çeviri dili
                            <select value={targetLang} onChange={event => setTargetLang(event.target.value)} className="eary-input mt-1 w-full rounded-lg border px-2 py-2 text-xs font-bold normal-case">
                                {SUPPORTED_LANGUAGES.map(item => <option key={item.code} value={item.code}>{item.nativeLabel}</option>)}
                            </select>
                        </label>
                        <button type="button" onClick={translateNote} disabled={!noteText.trim() || translating} className="eary-brand-bg rounded-lg px-3 py-2 text-[11px] font-bold disabled:opacity-30">{translating ? 'Bekle' : 'Uygula'}</button>
                        <button type="button" onClick={() => { setShowTranslationTools(false); setTranslation(''); }} className="eary-soft eary-muted flex h-9 w-9 items-center justify-center rounded-lg" title="Çeviriyi kapat"><X size={15}/></button>
                    </div>
                )}
            </section>

            <section className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4 pb-24">
                <textarea
                    ref={noteTextareaRef}
                    value={noteText}
                    onChange={handleNoteChange}
                    onScroll={handleNoteScroll}
                    placeholder="Konuşarak veya yazarak not alın..."
                    className="min-h-0 flex-1 w-full resize-none border-0 bg-transparent px-1 py-2 text-[19px] font-semibold leading-9 text-[var(--text)] outline-none placeholder:text-slate-400"
                    aria-label="Not metni"
                />
                {interim && <p className="eary-muted mt-2 text-xs font-semibold">{interim}</p>}
                {translation && <article className="mt-3 max-h-32 overflow-y-auto rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold leading-6 text-emerald-950 whitespace-pre-line">{translation}</article>}
            </section>

            <button type="button" onClick={toggleListening} className={`absolute bottom-[max(18px,env(safe-area-inset-bottom))] right-5 flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-white shadow-xl ${listening ? 'bg-rose-600' : 'eary-brand-bg'}`} aria-label={listening ? 'Not diktesini durdur' : 'Not diktesini başlat'}>{listening ? <StopCircle size={28}/> : <Mic size={28}/>}</button>
        </main>
    );
}

function FaceToFaceTool({ onBack }) {
    const [messages, setMessages] = useState([]);
    const [activeSide, setActiveSide] = useState('host');
    const [listening, setListening] = useState(false);
    const [interim, setInterim] = useState('');
    const [hostManualText, setHostManualText] = useState('');
    const [guestManualText, setGuestManualText] = useState('');
    const [translateEnabled, setTranslateEnabled] = useState(false);
    const [targetLang, setTargetLang] = useState('en-US');
    const [showOriginal, setShowOriginal] = useState({});
    const [showScrollDown, setShowScrollDown] = useState({ host: false, guest: false });
    const recognizerRef = useRef(null);
    const activeSideRef = useRef('host');
    const partialRef = useRef('');
    const listeningRef = useRef(false);
    const sentRef = useRef(false);
    const guestScrollRef = useRef(null);
    const hostScrollRef = useRef(null);

    useEffect(() => () => recognizerRef.current?.abort?.(), []);
    useEffect(() => {
        [guestScrollRef.current, hostScrollRef.current].forEach(node => {
            if (node) node.scrollTop = node.scrollHeight;
        });
    }, [messages, interim, activeSide, listening]);

    const getSideLanguage = side => (translateEnabled && side === 'guest' ? targetLang : 'tr-TR');
    const getTranslationTarget = side => (side === 'guest' ? 'tr-TR' : targetLang);
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

    const addMessage = async (side, text) => {
        const clean = String(text || '').replace(/\s+/g, ' ').trim();
        if (!clean) return;
        const sourceLang = getSideLanguage(side);
        const translationTarget = getTranslationTarget(side);
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const item = { id, side, text: clean, translation: '', sourceLang, createdAt: Date.now() };
        setMessages(current => [...current, item]);
        if (translateEnabled && sourceLang !== translationTarget) {
            const translation = await translateText(clean, translationTarget, sourceLang);
            if (translation && translation.toLocaleLowerCase('tr-TR') !== clean.toLocaleLowerCase('tr-TR')) {
                setMessages(current => current.map(message => message.id === id ? { ...message, translation } : message));
            }
        }
    };

    const commitSpeech = async () => {
        const text = partialRef.current.trim();
        if (!text || sentRef.current) return;
        sentRef.current = true;
        partialRef.current = '';
        setInterim('');
        await addMessage(activeSideRef.current, text);
    };

    const stopListening = async () => {
        listeningRef.current = false;
        setListening(false);
        recognizerRef.current?.stop?.();
        await commitSpeech();
        recognizerRef.current = null;
    };

    const startListening = async side => {
        if (listeningRef.current) {
            await stopListening();
            if (activeSideRef.current === side) return;
        }
        activeSideRef.current = side;
        setActiveSide(side);
        partialRef.current = '';
        sentRef.current = false;
        setInterim('');
        const recognizerLang = getSideLanguage(side);
        const recognizer = getDuoSpeechRecognizer(
            recognizerLang,
            (finalText, interimText) => {
                const next = String(finalText || interimText || '').trim();
                if (!next) return;
                partialRef.current = next;
                setInterim(next);
                if (finalText?.trim()) commitSpeech();
            },
            () => {
                listeningRef.current = false;
                setListening(false);
                commitSpeech();
            },
            error => {
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
        } catch (error) {
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
        const text = (side === 'host' ? hostManualText : guestManualText).trim();
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
            {showScrollDown[side] && <button type="button" onClick={() => scrollToBottom(side)} className={`absolute bottom-2 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-[#7B52AB] text-sm text-white shadow-lg ${rotated ? 'rotate-180' : ''}`}>↓</button>}
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
                            <input value={value} onChange={event => setValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') sendManual(side); }} placeholder={label} className="eary-input min-w-0 rounded-lg border px-3 py-2 text-sm" />
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
                <button type="button" onClick={() => setTranslateEnabled(value => !value)} className={`flex h-8 w-8 items-center justify-center rounded-lg ${translateEnabled ? 'bg-[#7B52AB] text-white' : 'eary-soft eary-brand'}`} title="Çeviri"><Languages size={17} /></button>
            </header>
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

export default function AccessibilityHub({ account, onOpenChats, onOpenSettings }) {
    const [view, setView] = useState('home');
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
                setView('home');
            }
        };
        window.addEventListener('eary:back', handleBack);
        return () => window.removeEventListener('eary:back', handleBack);
    }, [showContacts, view]);
    if (view==='environment') return <EnvironmentMonitor onBack={()=>setView('home')}/>;
    if (view==='ambient') return <AmbientListeningTool onBack={()=>setView('home')}/>;
    if (view==='notebook') return <VoiceNotebook onBack={()=>setView('home')}/>;
    if (view==='emergency') return <EmergencyCard nickname={account?.nickname} onBack={()=>setView('home')}/>;
    if (view==='face') return <FaceToFaceTool onBack={()=>setView('home')}/>;
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
                            <span className="block text-base font-bold">Ortam Dinleme</span>
                            <span className="mt-1 block text-[10px] leading-4 text-white/75">Sınıf, toplantı veya yaka mikrofonu ile canlı metin, anlam düzeltme, özet ve önemli notlar</span>
                        </span>
                        <ChevronRight size={18}/>
                    </button>
                    <button type="button" onClick={()=>setView('notebook')} className="col-span-2 flex items-center gap-4 rounded-lg bg-[#172f29] p-4 text-left text-white">
                        <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/10"><FileText size={23}/></span>
                        <span className="flex-1"><span className="block text-sm font-bold">Not Defteri</span><span className="mt-1 block text-[10px] leading-4 text-white/70">Ders, toplantı veya günlük notları bas-konuş ile yazıya çevir</span></span>
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
                    {captionSessions.slice(0,4).map(session=><div key={session.id} className="flex items-center gap-3 border-b eary-line py-3"><Captions size={17} className="eary-muted"/><div className="flex-1"><p className="text-xs font-semibold">{session.title}</p><p className="eary-muted text-[9px]">{new Date(session.createdAt).toLocaleString('tr-TR')} · {session.captions.length} paragraf · {session.captions.filter(line=>line.important).length} önemli</p></div></div>)}
                </section>}

                <div className="mx-4 mt-5 rounded-lg border eary-line p-3">
                    <div className="flex gap-3"><Sparkles size={18} className="eary-brand shrink-0"/><p className="eary-muted text-[10px] leading-4">Ortam dinleme konuşmayı daha okunur hâle getirir; ham ses kaydı yapmaz. Özet paneli açıldığında mikrofon dinlemeye devam eder.</p></div>
                </div>
            </div>
            <nav className="eary-shell absolute bottom-0 left-0 right-0 grid grid-cols-3 border-t eary-line px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2">
                <button type="button" className="eary-brand flex flex-col items-center gap-1 text-[10px] font-bold"><Sparkles size={20}/>Erişim</button>
                <button type="button" onClick={onOpenChats} className="eary-muted flex flex-col items-center gap-1 text-[10px] font-semibold"><MessageCircle size={20}/>Sohbetler</button>
                <button type="button" onClick={onOpenSettings} className="eary-muted flex flex-col items-center gap-1 text-[10px] font-semibold"><UserRound size={20}/>Profil</button>
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
