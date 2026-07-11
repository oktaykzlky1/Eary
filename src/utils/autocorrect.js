const WORD_CHARS = 'A-Za-z0-9\\u00C0-\\u024F\\u0100-\\u017F';
const DUPLICATE_WORD_RE = new RegExp(`\\b([${WORD_CHARS}]{2,})\\s+\\1\\b`, 'gi');

const TURKISH_REPLACEMENTS = [
    [/\bşuan\b/giu, 'şu an'],
    [/\bşuanda\b/giu, 'şu anda'],
    [/\bherşey\b/giu, 'her şey'],
    [/\bbişey\b/giu, 'bir şey'],
    [/\bhiç bir\b/giu, 'hiçbir'],
    [/\bherkez\b/giu, 'herkes'],
    [/\byanlız\b/giu, 'yalnız'],
    [/\byalnış\b/giu, 'yanlış'],
    [/\bmalesef\b/giu, 'maalesef'],
    [/\bdeyil\b/giu, 'değil'],
    [/\bdemi\b/giu, 'değil mi'],
    [/\bbuda\b/giu, 'bu da'],
    [/\byada\b/giu, 'ya da'],
    [/\bsende\b/giu, 'sen de'],
    [/\bbende\b/giu, 'ben de'],
    [/\bnapıyorsun\b/giu, 'ne yapıyorsun'],
    [/\bnapıyosun\b/giu, 'ne yapıyorsun'],
    [/\bgeliyom\b/giu, 'geliyorum'],
    [/\bgidiyom\b/giu, 'gidiyorum'],
    [/\byapıyo\b/giu, 'yapıyor'],
    [/\bgeliyo\b/giu, 'geliyor'],
    [/\bgidiyo\b/giu, 'gidiyor'],
    [/\byapıcam\b/giu, 'yapacağım'],
    [/\byapıcak\b/giu, 'yapacak'],
    [/\byapıcaz\b/giu, 'yapacağız'],
    [/\bgelicem\b/giu, 'geleceğim'],
    [/\bgelicek\b/giu, 'gelecek'],
    [/\bgelicez\b/giu, 'geleceğiz'],
    [/\bgitcem\b/giu, 'gideceğim'],
    [/\bgitcez\b/giu, 'gideceğiz'],
    [/\bgörücez\b/giu, 'göreceğiz'],
    [/\btürkiyenin\b/giu, "Türkiye'nin"],
    [/\btürkçe\b/giu, 'Türkçe'],
    [/\bingilizce\b/giu, 'İngilizce'],
    [/\balmanca\b/giu, 'Almanca'],
    [/\bpdf\b/giu, 'PDF'],
    [/\beary\b/giu, 'Eary']
];

const CONTEXT_REPLACEMENTS = {
    lesson: [
        [/\bşahin topları\b/giu, 'Şahi topları'],
        [/\bşahi topları\b/giu, 'Şahi topları'],
        [/\bfatih sultan mehmet\b/giu, 'Fatih Sultan Mehmet'],
        [/\bistanbulun fethi\b/giu, "İstanbul'un fethi"],
        [/\bistanbul'un fethi\b/giu, "İstanbul'un fethi"],
        [/\bosmanlı imparatorluğu\b/giu, 'Osmanlı İmparatorluğu'],
        [/\bbiz türkler\b/giu, 'biz Türkler'],
        [/\btürkler\b/giu, 'Türkler'],
        [/\bkocaeli\b/giu, 'Kocaeli']
    ],
    meeting: [
        [/\bdeadline\b/giu, 'son teslim tarihi'],
        [/\baksiyon\b/giu, 'aksiyon'],
        [/\btoplantı notu\b/giu, 'toplantı notu']
    ],
    chat: [
        [/\bslm\b/giu, 'selam'],
        [/\bmrb\b/giu, 'merhaba']
    ],
    face: [
        [/\bkarşı taraf\b/giu, 'karşı taraf']
    ]
};

const ENGLISH_REPLACEMENTS = [
    [/\bi\b/g, 'I'],
    [/\bim\b/gi, "I'm"],
    [/\bdont\b/gi, "don't"],
    [/\bcant\b/gi, "can't"],
    [/\bwont\b/gi, "won't"],
    [/\bwhats\b/gi, "what's"],
    [/\byoure\b/gi, "you're"]
];

const GERMAN_REPLACEMENTS = [
    [/\bdeutsch\b/giu, 'Deutsch'],
    [/\btürkisch\b/giu, 'Türkisch'],
    [/\benglisch\b/giu, 'Englisch'],
    [/\bwie gehts\b/giu, "wie geht's"]
];

const TURKISH_SAFE_TERMS = [
    ['şuan', 'şu an'],
    ['şuanda', 'şu anda'],
    ['herşey', 'her şey'],
    ['bişey', 'bir şey'],
    ['hiç bir', 'hiçbir'],
    ['herkez', 'herkes'],
    ['yanlız', 'yalnız'],
    ['yalnış', 'yanlış'],
    ['malesef', 'maalesef'],
    ['deyil', 'değil'],
    ['demi', 'değil mi'],
    ['buda', 'bu da'],
    ['yada', 'ya da'],
    ['sende', 'sen de'],
    ['bende', 'ben de'],
    ['napıyorsun', 'ne yapıyorsun'],
    ['napıyosun', 'ne yapıyorsun'],
    ['şahin topları', 'Şahi topları'],
    ['şahi topları', 'Şahi topları'],
    ['fatih sultan mehmet', 'Fatih Sultan Mehmet'],
    ['istanbulun fethi', "İstanbul'un fethi"],
    ["istanbul'un fethi", "İstanbul'un fethi"],
    ['osmanlı imparatorluğu', 'Osmanlı İmparatorluğu'],
    ['türkiyenin', "Türkiye'nin"],
    ['türkçe', 'Türkçe'],
    ['ingilizce', 'İngilizce'],
    ['almanca', 'Almanca'],
    ['eary', 'Eary']
];

const TURKISH_QUESTION_PARTICLES = [
    'miyim', 'mıyım', 'muyum', 'müyüm',
    'misiniz', 'mısınız', 'musunuz', 'müsünüz',
    'miyiz', 'mıyız', 'muyuz', 'müyüz',
    'miydi', 'mıydı', 'muydu', 'müydü',
    'misin', 'mısın', 'musun', 'müsün',
    'mi', 'mı', 'mu', 'mü'
];

const QUESTION_CUES_TR = [
    'mi', 'mı', 'mu', 'mü', 'miyim', 'mıyım', 'muyum', 'müyüm',
    'misin', 'mısın', 'musun', 'müsün', 'misiniz', 'mısınız', 'musunuz', 'müsünüz',
    'nasıl', 'neden', 'niye', 'kim', 'kime', 'kimi', 'hangi', 'nerede', 'nereye',
    'nereden', 'ne zaman', 'kaç', 'neler', 'nelerdir'
];

const normalizeContext = context => {
    const value = String(context || '').toLowerCase();
    if (['lesson', 'ders', 'conference', 'konferans'].includes(value)) return 'lesson';
    if (['meeting', 'toplantı'].includes(value)) return 'meeting';
    if (['face', 'yüzyüze', 'yuz yuze'].includes(value)) return 'face';
    if (['chat', 'sohbet'].includes(value)) return 'chat';
    return 'general';
};

const applyReplacements = (text, replacements) => replacements.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    text
);

const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const replaceTerm = (text, from, to) => {
    const pattern = new RegExp(`(^|[^${WORD_CHARS}])(${escapeRegExp(from)})(?=$|[^${WORD_CHARS}])`, 'giu');
    return String(text || '').replace(pattern, (match, prefix) => `${prefix}${to}`);
};

const applySafeTerms = (text, terms) => terms.reduce(
    (current, [from, to]) => replaceTerm(current, from, to),
    text
);

const titleCaseTerm = term => String(term || '')
    .split(/\s+/)
    .map(part => part ? part[0].toLocaleUpperCase('tr-TR') + part.slice(1) : part)
    .join(' ');

const getPersonalTerms = extraTerms => {
    const terms = new Set((Array.isArray(extraTerms) ? extraTerms : []).map(String).filter(Boolean));
    try {
        const stored = JSON.parse(localStorage.getItem('eary_personal_terms') || '[]');
        stored.forEach(term => {
            if (typeof term === 'string' && term.trim()) terms.add(term.trim());
            if (term?.value) terms.add(String(term.value).trim());
        });
    } catch {
        // Personal dictionary is optional.
    }
    return [...terms].filter(term => term.length >= 2).slice(0, 200);
};

const applyPersonalDictionary = (text, terms = []) => {
    let next = text;
    getPersonalTerms(terms).forEach(term => {
        const normalized = term.trim();
        if (!normalized) return;
        const pattern = new RegExp(`\\b${escapeRegExp(normalized)}\\b`, 'giu');
        next = next.replace(pattern, normalized);
        const plain = normalized
            .toLocaleLowerCase('tr-TR')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
        if (plain && plain !== normalized.toLocaleLowerCase('tr-TR')) {
            next = next.replace(new RegExp(`\\b${escapeRegExp(plain)}\\b`, 'giu'), normalized);
        }
    });
    return next;
};

const splitTurkishQuestionParticles = text => text
    .split(/\s+/)
    .map(word => {
        const clean = word.toLocaleLowerCase('tr-TR').replace(/[.,!?;:]+$/g, '');
        if (TURKISH_QUESTION_PARTICLES.includes(clean)) return word;
        const particle = TURKISH_QUESTION_PARTICLES.find(item => clean.endsWith(item) && clean.length > item.length + 1);
        if (!particle) return word;
        return `${word.slice(0, word.length - particle.length)} ${word.slice(word.length - particle.length)}`;
    })
    .join(' ')
    .replace(/\s+/g, ' ');

const hasQuestionCue = text => {
    const lower = String(text || '').toLocaleLowerCase('tr-TR');
    return QUESTION_CUES_TR.some(cue => new RegExp(`(^|\\s)${escapeRegExp(cue)}(\\s|$)`, 'u').test(lower));
};

const capitalizeSentences = text => String(text || '').replace(
    /(^\s*|[.!?]\s+)([a-zçğıöşü])/giu,
    (match, prefix, letter) => prefix + letter.toLocaleUpperCase('tr-TR')
);

const finalizePunctuation = (text, language = 'tr-TR') => {
    let next = String(text || '').replace(/\s+([.,!?;:])/g, '$1').trim();
    if (!next) return '';
    if (language.startsWith('tr') && next.endsWith('?') && !hasQuestionCue(next)) {
        next = `${next.slice(0, -1)}.`;
    }
    if (!/[.!?]$/.test(next)) {
        next += language.startsWith('tr') && hasQuestionCue(next) ? '?' : '.';
    }
    return capitalizeSentences(next);
};

export const rememberPersonalTerms = terms => {
    const incoming = (Array.isArray(terms) ? terms : [terms])
        .map(term => String(term || '').trim())
        .filter(term => term.length >= 2);
    if (!incoming.length) return;
    try {
        const current = getPersonalTerms();
        const merged = [...new Set([...incoming, ...current])].slice(0, 200);
        localStorage.setItem('eary_personal_terms', JSON.stringify(merged));
    } catch {
        // Ignore storage failures.
    }
};

export const extractPersonalTerms = (...values) => {
    const text = values.join(' ');
    const candidates = text.match(/\b[A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğıöşü]{1,}(?:\s+[A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğıöşü]{1,}){0,3}\b/g) || [];
    return [...new Set(candidates.map(titleCaseTerm))].slice(0, 40);
};

export function correctTranscription(text, language = 'tr-TR', options = {}) {
    if (!text || !String(text).trim()) return '';

    const context = normalizeContext(options.context || options.mode);
    const finalize = options.finalize !== false && !options.live;
    const isTurkish = String(language).startsWith('tr');
    const isEnglish = String(language).startsWith('en');
    const isGerman = String(language).startsWith('de');

    let cleaned = String(text)
        .replace(/\s+/g, ' ')
        .replace(DUPLICATE_WORD_RE, '$1')
        .trim();

    if (isTurkish) {
        cleaned = applyReplacements(cleaned, TURKISH_REPLACEMENTS);
        cleaned = applySafeTerms(cleaned, TURKISH_SAFE_TERMS);
        cleaned = applyReplacements(cleaned, CONTEXT_REPLACEMENTS[context] || []);
        if (context === 'lesson' || context === 'general') {
            cleaned = applyReplacements(cleaned, CONTEXT_REPLACEMENTS.lesson);
        }
        cleaned = applySafeTerms(cleaned, TURKISH_SAFE_TERMS);
        cleaned = splitTurkishQuestionParticles(cleaned);
        cleaned = applyPersonalDictionary(cleaned, options.personalTerms);
    } else if (isEnglish) {
        cleaned = applyReplacements(cleaned, ENGLISH_REPLACEMENTS);
        cleaned = applyPersonalDictionary(cleaned, options.personalTerms);
    } else if (isGerman) {
        cleaned = applyReplacements(cleaned, GERMAN_REPLACEMENTS);
        cleaned = applyPersonalDictionary(cleaned, options.personalTerms);
    } else {
        cleaned = applyPersonalDictionary(cleaned, options.personalTerms);
    }

    cleaned = cleaned
        .replace(/\s+/g, ' ')
        .replace(/\s+([.,!?;:])/g, '$1')
        .trim();

    return finalize ? finalizePunctuation(cleaned, language) : cleaned;
}
