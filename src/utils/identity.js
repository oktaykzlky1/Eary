import { sha256Hex } from './hash';

const COUNTRY_CODES = { at: '43', de: '49', tr: '90', ch: '41', nl: '31', fr: '33', it: '39', es: '34', gb: '44', us: '1' };

export const normalizePhone = (value, countryIso = '') => {
    const trimmed = String(value || '').trim();
    const digits = trimmed.replace(/\D/g, '');
    if (!digits) return '';
    if (trimmed.startsWith('+')) return `+${digits}`;
    if (digits.startsWith('00')) return `+${digits.slice(2)}`;
    const countryCode = COUNTRY_CODES[countryIso.toLowerCase()];
    if (countryCode && digits.startsWith('0')) return `+${countryCode}${digits.slice(1)}`;
    return `+${digits}`;
};

export const phoneLookupKey = async phone => sha256Hex(`eary-phone:${normalizePhone(phone)}`);
