import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const encodeBase32 = (bytes: Uint8Array): string => {
    let bits = 0;
    let value = 0;
    let output = "";
    for (const byte of bytes) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            output += alphabet[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
    return output;
};

const decodeBase32 = (input: string): Buffer => {
    let bits = 0;
    let value = 0;
    const output: number[] = [];
    for (const character of input.toUpperCase().replace(/[^A-Z2-7]/gu, "")) {
        const index = alphabet.indexOf(character);
        if (index < 0) return Buffer.alloc(0);
        value = (value << 5) | index;
        bits += 5;
        if (bits >= 8) {
            output.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(output);
};

export const generateTotpSecret = (): string => encodeBase32(randomBytes(20));

export const totpCode = (secret: string, time = Date.now(), period = 30): string => {
    const counter = Math.floor(time / 1_000 / period);
    const message = Buffer.alloc(8);
    message.writeBigUInt64BE(BigInt(counter));
    const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
    const offset = (digest[19] ?? 0) & 15;
    const binary = ((digest[offset] ?? 0) & 127) << 24 | (digest[offset + 1] ?? 0) << 16 | (digest[offset + 2] ?? 0) << 8 | (digest[offset + 3] ?? 0);
    return String(binary % 1_000_000).padStart(6, "0");
};

export const verifyTotp = (secret: string, supplied: string, time = Date.now()): boolean => {
    return totpStep(secret, supplied, time) !== undefined;
};

export const totpStep = (secret: string, supplied: string, time = Date.now()): number | undefined => {
    const normalized = supplied.replace(/\s/gu, "");
    if (!/^\d{6}$/u.test(normalized)) return undefined;
    for (const offset of [-30_000, 0, 30_000]) {
        if (timingSafeEqual(Buffer.from(totpCode(secret, time + offset)), Buffer.from(normalized))) {
            return Math.floor((time + offset) / 30_000);
        }
    }
    return undefined;
};

export const generateRecoveryCodes = (): readonly string[] =>
    Array.from({ length: 8 }, () => `${randomBytes(4).toString("hex")}-${randomBytes(4).toString("hex")}`);
