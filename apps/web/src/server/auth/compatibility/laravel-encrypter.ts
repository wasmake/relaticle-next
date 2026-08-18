import {
    createCipheriv,
    createDecipheriv,
    createHmac,
    randomBytes,
    timingSafeEqual,
} from "node:crypto";
import { TextDecoder } from "node:util";

const APP_KEY_BYTES = 32;
const CBC_IV_BYTES = 16;
const COOKIE_PREFIX_BYTES = 41;
const HMAC_SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export type LaravelAppKeyInput = string | Uint8Array;
export type LaravelPayloadFormat = "raw-string" | "php-serialized";

export class InvalidLaravelAppKeyError extends Error {
    public constructor() {
        super("Laravel APP_KEY must contain exactly 32 bytes.");
        this.name = "InvalidLaravelAppKeyError";
    }
}

export class InvalidLaravelEncryptedPayloadError extends Error {
    public constructor() {
        super("Laravel encrypted payload is invalid.");
        this.name = "InvalidLaravelEncryptedPayloadError";
    }
}

export class UnsupportedLaravelEncryptedPayloadError extends Error {
    public constructor() {
        super(
            "Only raw AES-256-CBC Laravel string payloads are supported; AEAD and PHP serialization are unsupported.",
        );
        this.name = "UnsupportedLaravelEncryptedPayloadError";
    }
}

type LaravelEncryptedPayload = Readonly<{
    iv: string;
    value: string;
    mac: string;
    tag?: string;
}>;

const isUnknownRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const decodeStrictBase64 = (encoded: string): Buffer | undefined => {
    if (
        encoded.length === 0 ||
        encoded.length % 4 === 1 ||
        !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)
    ) {
        return undefined;
    }

    const unpadded = encoded.replace(/=+$/u, "");
    const padded = unpadded.padEnd(Math.ceil(unpadded.length / 4) * 4, "=");
    const decoded = Buffer.from(padded, "base64");
    const canonical = decoded.toString("base64");

    if (encoded !== canonical && encoded !== canonical.replace(/=+$/u, "")) {
        return undefined;
    }

    return decoded;
};

export const parseLaravelAppKey = (configuredKey: string): Buffer => {
    const key = configuredKey.startsWith("base64:")
        ? decodeStrictBase64(configuredKey.slice("base64:".length))
        : Buffer.from(configuredKey, "utf8");

    if (key === undefined || key.length !== APP_KEY_BYTES) {
        throw new InvalidLaravelAppKeyError();
    }

    return Buffer.from(key);
};

const normalizeAppKey = (appKey: LaravelAppKeyInput): Buffer => {
    if (typeof appKey === "string") {
        return parseLaravelAppKey(appKey);
    }

    if (appKey.byteLength !== APP_KEY_BYTES) {
        throw new InvalidLaravelAppKeyError();
    }

    return Buffer.from(appKey);
};

const decodePossiblyUrlEncodedValue = (value: string): string => {
    try {
        return decodeURIComponent(value);
    } catch {
        throw new InvalidLaravelEncryptedPayloadError();
    }
};

const parseEncryptedPayload = (encodedPayload: string): LaravelEncryptedPayload => {
    const outerPayload = decodeStrictBase64(
        decodePossiblyUrlEncodedValue(encodedPayload),
    );

    if (outerPayload === undefined) {
        throw new InvalidLaravelEncryptedPayloadError();
    }

    let payload: unknown;

    try {
        payload = JSON.parse(outerPayload.toString("utf8"));
    } catch {
        throw new InvalidLaravelEncryptedPayloadError();
    }

    if (!isUnknownRecord(payload)) {
        throw new InvalidLaravelEncryptedPayloadError();
    }

    const { iv, value, mac, tag } = payload;

    if (
        typeof iv !== "string" ||
        typeof value !== "string" ||
        typeof mac !== "string" ||
        (tag !== undefined && typeof tag !== "string")
    ) {
        throw new InvalidLaravelEncryptedPayloadError();
    }

    if (tag !== undefined && tag.length > 0) {
        throw new UnsupportedLaravelEncryptedPayloadError();
    }

    return tag === undefined
        ? { iv, value, mac }
        : { iv, value, mac, tag };
};

const decryptLaravelBytes = (
    encodedPayload: string,
    appKey: LaravelAppKeyInput,
): Buffer => {
    const key = normalizeAppKey(appKey);
    const payload = parseEncryptedPayload(encodedPayload);
    const expectedMac = createHmac("sha256", key)
        .update(payload.iv + payload.value, "utf8")
        .digest();
    const suppliedMacIsValid = HMAC_SHA256_HEX_PATTERN.test(payload.mac);
    const suppliedMac = suppliedMacIsValid
        ? Buffer.from(payload.mac, "hex")
        : Buffer.alloc(expectedMac.length);
    const macMatches = timingSafeEqual(expectedMac, suppliedMac);

    if (!suppliedMacIsValid || !macMatches) {
        throw new InvalidLaravelEncryptedPayloadError();
    }

    const iv = decodeStrictBase64(payload.iv);
    const ciphertext = decodeStrictBase64(payload.value);

    if (
        iv === undefined ||
        iv.length !== CBC_IV_BYTES ||
        ciphertext === undefined ||
        ciphertext.length === 0 ||
        ciphertext.length % CBC_IV_BYTES !== 0
    ) {
        throw new InvalidLaravelEncryptedPayloadError();
    }

    try {
        const decipher = createDecipheriv("aes-256-cbc", key, iv);

        return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
        throw new InvalidLaravelEncryptedPayloadError();
    }
};

const decodeUtf8 = (value: Uint8Array): string => {
    try {
        return utf8Decoder.decode(value);
    } catch {
        throw new InvalidLaravelEncryptedPayloadError();
    }
};

/** Mirrors Laravel's encryptString(), which does not use PHP serialization. */
export const encryptLaravelString = (
    value: string,
    appKey: LaravelAppKeyInput,
): string => {
    const key = normalizeAppKey(appKey);
    const iv = randomBytes(CBC_IV_BYTES);
    const cipher = createCipheriv("aes-256-cbc", key, iv);
    const encrypted = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
    ]);
    const encodedIv = iv.toString("base64");
    const encodedValue = encrypted.toString("base64");
    const mac = createHmac("sha256", key)
        .update(encodedIv + encodedValue, "utf8")
        .digest("hex");
    const payload: LaravelEncryptedPayload = {
        iv: encodedIv,
        value: encodedValue,
        mac,
        tag: "",
    };

    return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
};

export const decryptLaravelPayload = (
    encodedPayload: string,
    appKey: LaravelAppKeyInput,
    format: LaravelPayloadFormat,
): string => {
    if (format === "php-serialized") {
        throw new UnsupportedLaravelEncryptedPayloadError();
    }

    return decodeUtf8(decryptLaravelBytes(encodedPayload, appKey));
};

/** Mirrors Laravel's decryptString(), which does not use PHP serialization. */
export const decryptLaravelString = (
    encodedPayload: string,
    appKey: LaravelAppKeyInput,
): string => decryptLaravelPayload(encodedPayload, appKey, "raw-string");

export const decryptLaravelStringWithKeys = (
    encodedPayload: string,
    appKeys: readonly LaravelAppKeyInput[],
): string => {
    if (appKeys.length === 0) {
        throw new InvalidLaravelAppKeyError();
    }

    for (const appKey of appKeys) {
        try {
            return decryptLaravelString(encodedPayload, appKey);
        } catch (error) {
            if (
                error instanceof UnsupportedLaravelEncryptedPayloadError ||
                error instanceof InvalidLaravelAppKeyError
            ) {
                throw error;
            }
        }
    }

    throw new InvalidLaravelEncryptedPayloadError();
};

const createCookieValuePrefix = (
    cookieName: string,
    key: Uint8Array,
): Buffer =>
    Buffer.from(
        `${createHmac("sha1", key).update(`${cookieName}v2`, "utf8").digest("hex")}|`,
        "ascii",
    );

export const encryptLaravelCookie = (
    cookieName: string,
    value: string,
    appKey: LaravelAppKeyInput,
): string => {
    const key = normalizeAppKey(appKey);
    const prefix = createCookieValuePrefix(cookieName, key).toString("ascii");

    return encryptLaravelString(prefix + value, key);
};

export const decryptLaravelCookie = (
    cookieName: string,
    encodedCookieValue: string,
    appKey: LaravelAppKeyInput,
): string => {
    const key = normalizeAppKey(appKey);
    const decrypted = decryptLaravelBytes(encodedCookieValue, key);
    const expectedPrefix = createCookieValuePrefix(cookieName, key);
    const hasFullPrefix = decrypted.length >= COOKIE_PREFIX_BYTES;
    const suppliedPrefix = hasFullPrefix
        ? decrypted.subarray(0, COOKIE_PREFIX_BYTES)
        : Buffer.alloc(COOKIE_PREFIX_BYTES);
    const prefixMatches = timingSafeEqual(expectedPrefix, suppliedPrefix);

    if (!hasFullPrefix || !prefixMatches) {
        throw new InvalidLaravelEncryptedPayloadError();
    }

    return decodeUtf8(decrypted.subarray(COOKIE_PREFIX_BYTES));
};

export const parseLaravelAppKeys = (
    currentKey: string,
    previousKeys: string | undefined,
): readonly Buffer[] => {
    const configuredKeys = [
        currentKey,
        ...(previousKeys?.split(",").map((key) => key.trim()) ?? []),
    ].filter((key) => key !== "");

    return configuredKeys.map(parseLaravelAppKey);
};

export const decryptLaravelCookieWithKeys = (
    cookieName: string,
    encodedCookieValue: string,
    appKeys: readonly LaravelAppKeyInput[],
): string => {
    if (appKeys.length === 0) {
        throw new InvalidLaravelAppKeyError();
    }

    for (const appKey of appKeys) {
        try {
            return decryptLaravelCookie(cookieName, encodedCookieValue, appKey);
        } catch (error) {
            if (
                error instanceof UnsupportedLaravelEncryptedPayloadError ||
                error instanceof InvalidLaravelAppKeyError
            ) {
                throw error;
            }
        }
    }

    throw new InvalidLaravelEncryptedPayloadError();
};
