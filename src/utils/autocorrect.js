/**
 * Smart voice-to-text auto-correct utility.
 * Normalizes speech recognition text, splits question suffixes, fixes punctuation, and corrects common voice typos.
 */

const TURKISH_DICTIONARY = {
    "tamamdır": "tamamdır",
    "tamam dır": "tamamdır",
    "geliyom": "geliyorum",
    "gidiyom": "gidiyorum",
    "yapıyo": "yapıyor",
    "geliyo": "geliyor",
    "gidiyo": "gidiyor",
    "yapıcam": "yapacağım",
    "yapıcak": "yapacak",
    "yapıcaz": "yapacağız",
    "yapcam": "yapacağım",
    "yapcaz": "yapacağız",
    "gelicem": "geleceğim",
    "gelicek": "gelecek",
    "gelicez": "geleceğiz",
    "gelcem": "geleceğim",
    "gelcez": "geleceğiz",
    "gitcem": "gideceğim",
    "gitcez": "gideceğiz",
    "gidicez": "gideceğiz",
    "görcez": "göreceğiz",
    "göricez": "göreceğiz",
    "napıyorsun": "ne yapıyorsun",
    "napıyosun": "ne yapıyorsun",
    "bişey": "bir şey",
    "herşey": "her şey",
    "hiçbi": "hiçbir",
    "hiç bir": "hiçbir",
    "herkez": "herkes",
    "yanlız": "yalnız",
    "yalnış": "yanlış",
    "şuan": "şu an",
    "şuanda": "şu anda",
    "pekiyi": "peki",
    "malesef": "maalesef",
    "örneyin": "örneğin",
    "türkiyenin": "Türkiye'nin",
    "türkçe": "Türkçe",
    "almanya": "Almanya",
    "ingilizce": "İngilizce",
    "türk": "Türk",
    "almıyo": "almıyor",
    "gelmiyo": "gelmiyor",
    "gitmiyo": "gitmiyor",
    "yapmıyo": "yapmıyor",
    "olmıyo": "olmuyor",
    "olmicak": "olmayacak",
    "olmıycak": "olmayacak",
    "demi": "değil mi",
    "buda": "bu da",
    "yada": "ya da",
    "sende": "sen de",
    "bende": "ben de",
    "epi": "hep"
};

const ENGLISH_DICTIONARY = {
    "gonna": "going to",
    "wanna": "want to",
    "gotta": "got to",
    "dunno": "don't know",
    "i": "I",
    "im": "I'm",
    "dont": "don't",
    "cant": "can't",
    "wont": "won't",
    "shouldnt": "shouldn't",
    "couldnt": "couldn't",
    "wouldnt": "wouldn't",
    "its": "it's",
    "whats": "what's",
    "youre": "you're",
    "theyre": "they're",
    "weve": "we've",
    "ive": "I've",
    "id": "I'd",
    "youll": "you'll"
};

const GERMAN_DICTIONARY = {
    "hallo": "Hallo",
    "ja": "ja,",
    "nein": "nein,",
    "und": "und",
    "deutsch": "Deutsch",
    "türkisch": "Türkisch",
    "englisch": "Englisch",
    "wie gehts": "wie geht's",
    "gibts": "gibt's",
    "ne": "eine"
};

/**
 * Splits attached Turkish question particles (mi, mı, mu, mü, misin, musun, vb.)
 */
function splitTurkishQuestionParticles(text) {
    const particles = [
        "miyim", "mıyım", "muyum", "müyüm", 
        "misiniz", "mısınız", "musunuz", "müsünüz", 
        "miyiz", "mıyız", "muyuz", "müyüz", 
        "miydi", "mıydı", "muydu", "müydü", 
        "misin", "mısın", "musun", "müsün", 
        "mi", "mı", "mu", "mü"
    ];
    let words = text.split(" ");
    
    for (let i = 0; i < words.length; i++) {
        let word = words[i];
        
        // Skip if the word is already just the particle
        if (particles.includes(word.toLowerCase())) continue;
        
        for (let p of particles) {
            if (word.toLowerCase().endsWith(p) && word.length > p.length) {
                // Split the particle from the root word
                const root = word.substring(0, word.length - p.length);
                words[i] = `${root} ${p}`;
                break;
            }
        }
    }
    
    return words.join(" ").replace(/\s+/g, ' ');
}

/**
 * Capitalizes the first letter of each sentence
 */
function capitalizeSentences(text) {
    if (!text) return "";
    return text.replace(/(^\s*|[.!?]\s+)([a-zğçşöüıi])/g, (match, separator, letter) => {
        return separator + letter.toUpperCase();
    });
}

/**
 * Automatically corrects speech-to-text transcription logic based on the language
 */
export function correctTranscription(text, language = 'tr-TR') {
    if (!text || !text.trim()) return "";
    
    let cleaned = text.trim();
    const isTurkish = language.startsWith('tr');
    const isGerman = language.startsWith('de');
    const isEnglish = language.startsWith('en');

    // 1. Convert double spaces to single spaces
    cleaned = cleaned.replace(/\s+/g, ' ');
    if (isTurkish) {
        cleaned = cleaned.replace(/\b(\p{L}+)\s+\1\b/giu, '$1');
    }

    // 2. Vocabulary-based auto-correction
    let words = cleaned.split(" ");
    const dict = isTurkish ? TURKISH_DICTIONARY : isEnglish ? ENGLISH_DICTIONARY : isGerman ? GERMAN_DICTIONARY : {};
    
    for (let i = 0; i < words.length; i++) {
        const lowerWord = words[i].toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()]/g,"");
        if (dict[lowerWord]) {
            // Retain capitalization if word started with uppercase
            const replacement = dict[lowerWord];
            if (words[i][0] === words[i][0].toUpperCase()) {
                words[i] = replacement[0].toUpperCase() + replacement.slice(1);
            } else {
                words[i] = replacement;
            }
        }
    }
    cleaned = words.join(" ");

    // 3. Language-specific grammar/syntax formatting
    if (isTurkish) {
        cleaned = splitTurkishQuestionParticles(cleaned);
        
        // Auto-add question mark if sentence contains question words/particles
        const questionParticles = [" mi", " mı", " mu", " mü", " nasıl", " neden", " niye", " kim", " nerede", " ne zaman", " kaç"];
        const needsQuestionMark = questionParticles.some(p => cleaned.toLowerCase().includes(p)) && !cleaned.endsWith('?');
        if (needsQuestionMark) {
            // Remove ending dot if any
            if (cleaned.endsWith('.')) cleaned = cleaned.slice(0, -1);
            cleaned += "?";
        }
    } else if (isEnglish) {
        // Auto-add question mark if sentence starts with question words
        const enQuestionRegex = /(?:^\s*|[.!?]\s+)(what|who|where|when|why|how|is|are|do|does|did|can|could|would|should|will)\b/i;
        const needsQuestionMark = enQuestionRegex.test(cleaned) && !cleaned.endsWith('?');
        if (needsQuestionMark) {
            if (cleaned.endsWith('.')) cleaned = cleaned.slice(0, -1);
            cleaned += "?";
        }
    } else if (isGerman) {
        // Auto-add question mark if sentence starts with question words
        const deQuestionRegex = /(?:^\s*|[.!?]\s+)(wer|was|wo|wann|warum|wie|welcher|wieso|weshalb|ist|sind|hast|haben|kann|kannst|willst|können|sollte)\b/i;
        const needsQuestionMark = deQuestionRegex.test(cleaned) && !cleaned.endsWith('?');
        if (needsQuestionMark) {
            if (cleaned.endsWith('.')) cleaned = cleaned.slice(0, -1);
            cleaned += "?";
        }
    }

    // 4. Default Sentence capitalization and punctuation
    cleaned = capitalizeSentences(cleaned);
    
    // Add default period if sentence doesn't end with punctuation
    if (cleaned && !/[.!?]$/.test(cleaned)) {
        cleaned += ".";
    }

    return cleaned;
}
