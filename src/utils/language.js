export const SUPPORTED_LANGUAGES = [
    { code: 'tr-TR', short: 'TR', label: 'Türkçe', nativeLabel: 'Türkçe' },
    { code: 'en-US', short: 'EN', label: 'English', nativeLabel: 'English' },
    { code: 'de-DE', short: 'DE', label: 'Deutsch', nativeLabel: 'Deutsch' },
    { code: 'fr-FR', short: 'FR', label: 'Français', nativeLabel: 'Français' },
    { code: 'es-ES', short: 'ES', label: 'Español', nativeLabel: 'Español' },
    { code: 'it-IT', short: 'IT', label: 'Italiano', nativeLabel: 'Italiano' }
];

const FALLBACK_LANGUAGE = 'tr-TR';

export const normalizeAppLanguage = value => {
    const raw = String(value || '').replace('_', '-').trim();
    if (!raw) return FALLBACK_LANGUAGE;
    const direct = SUPPORTED_LANGUAGES.find(language => language.code.toLowerCase() === raw.toLowerCase());
    if (direct) return direct.code;
    const prefix = raw.slice(0, 2).toLowerCase();
    return SUPPORTED_LANGUAGES.find(language => language.code.toLowerCase().startsWith(prefix))?.code || FALLBACK_LANGUAGE;
};

export const getDeviceLanguage = () => normalizeAppLanguage(
    (typeof navigator !== 'undefined' && (navigator.languages?.[0] || navigator.language)) || FALLBACK_LANGUAGE
);

export const getInitialAppLanguage = () => normalizeAppLanguage(
    (typeof localStorage !== 'undefined' && (localStorage.getItem('eary_app_language') || localStorage.getItem('eary_speech_lang'))) || getDeviceLanguage()
);

export const getLanguageLabel = code => SUPPORTED_LANGUAGES.find(language => language.code === normalizeAppLanguage(code))?.label || 'Türkçe';
