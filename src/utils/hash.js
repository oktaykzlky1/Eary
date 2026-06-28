const fallbackSha256 = input => {
    const rightRotate = (value, amount) => (value >>> amount) | (value << (32 - amount));
    const bytes = new TextEncoder().encode(input);
    const words = [];
    for (const byte of bytes) words.push(byte);
    words.push(0x80);
    while ((words.length % 64) !== 56) words.push(0);
    const bitLength = bytes.length * 8;
    for (let index = 7; index >= 0; index -= 1) words.push(index < 4 ? (bitLength >>> (index * 8)) & 0xff : 0);

    const constants = [];
    const initial = [];
    let candidate = 2;
    while (constants.length < 64) {
        let prime = true;
        for (let factor = 2; factor * factor <= candidate; factor += 1) {
            if (candidate % factor === 0) { prime = false; break; }
        }
        if (prime) {
            if (initial.length < 8) initial.push((Math.sqrt(candidate) * 0x100000000) | 0);
            constants.push((Math.cbrt(candidate) * 0x100000000) | 0);
        }
        candidate += 1;
    }

    const hash = [...initial];
    for (let offset = 0; offset < words.length; offset += 64) {
        const schedule = new Array(64);
        for (let index = 0; index < 16; index += 1) {
            const start = offset + index * 4;
            schedule[index] = ((words[start] << 24) | (words[start + 1] << 16) | (words[start + 2] << 8) | words[start + 3]) | 0;
        }
        for (let index = 16; index < 64; index += 1) {
            const a = schedule[index - 15];
            const b = schedule[index - 2];
            const s0 = rightRotate(a, 7) ^ rightRotate(a, 18) ^ (a >>> 3);
            const s1 = rightRotate(b, 17) ^ rightRotate(b, 19) ^ (b >>> 10);
            schedule[index] = (schedule[index - 16] + s0 + schedule[index - 7] + s1) | 0;
        }
        let [a, b, c, d, e, f, g, h] = hash;
        for (let index = 0; index < 64; index += 1) {
            const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
            const choose = (e & f) ^ (~e & g);
            const temp1 = (h + s1 + choose + constants[index] + schedule[index]) | 0;
            const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
            const majority = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (s0 + majority) | 0;
            h = g; g = f; f = e; e = (d + temp1) | 0; d = c; c = b; b = a; a = (temp1 + temp2) | 0;
        }
        [a, b, c, d, e, f, g, h].forEach((value, index) => { hash[index] = (hash[index] + value) | 0; });
    }
    return hash.map(value => (value >>> 0).toString(16).padStart(8, '0')).join('');
};

export const sha256Hex = async input => {
    if (globalThis.crypto?.subtle) {
        const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
        return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
    }
    return fallbackSha256(input);
};
