import {
    createCipheriv,
    createDecipheriv,
    createHash,
    createHmac,
} from "node:crypto";

import { describe, expect, it } from "vitest";
import { hash } from "bcryptjs";

import {
    decryptLaravelCookie,
    decryptLaravelCookieWithKeys,
    decryptLaravelPayload,
    decryptLaravelString,
    encryptLaravelCookie,
    encryptLaravelString,
    InvalidLaravelAppKeyError,
    InvalidLaravelEncryptedPayloadError,
    parseLaravelAppKey,
    parseLaravelAppKeys,
    UnsupportedLaravelEncryptedPayloadError,
} from "@/server/auth/compatibility/laravel-encrypter";
import {
    hashSanctumTokenSecret,
    InvalidSanctumTokenFormatError,
    parseSanctumPlainTextToken,
    verifySanctumTokenSecret,
} from "@/server/auth/compatibility/sanctum";
import {
    isLaravelBcryptHash,
    verifyLaravelPassword,
} from "@/server/auth/compatibility/password";
import { resolveLegacySession } from "@/server/auth/compatibility/legacy-session";

type TestPayload = {
    iv: string;
    value: string;
    mac: string;
    tag?: string;
};

const key = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
const configuredKey = `base64:${key.toString("base64")}`;
const fixedIv = Buffer.from("abcdef0123456789", "utf8");

const encodePayload = (payload: TestPayload): string =>
    Buffer.from(JSON.stringify(payload), "utf8").toString("base64");

const decodePayload = (encodedPayload: string): TestPayload =>
    JSON.parse(Buffer.from(encodedPayload, "base64").toString("utf8")) as TestPayload;

const createLaravelFixture = (
    value: string,
    iv: Buffer = fixedIv,
): string => {
    const cipher = createCipheriv("aes-256-cbc", key, iv);
    const ciphertext = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
    ]);
    const encodedIv = iv.toString("base64");
    const encodedValue = ciphertext.toString("base64");

    return encodePayload({
        iv: encodedIv,
        value: encodedValue,
        mac: createHmac("sha256", key)
            .update(encodedIv + encodedValue, "utf8")
            .digest("hex"),
        tag: "",
    });
};

const independentlyDecryptLaravelPayload = (encodedPayload: string): string => {
    const payload = decodePayload(encodedPayload);
    const expectedMac = createHmac("sha256", key)
        .update(payload.iv + payload.value, "utf8")
        .digest("hex");

    expect(payload.mac).toBe(expectedMac);

    const decipher = createDecipheriv(
        "aes-256-cbc",
        key,
        Buffer.from(payload.iv, "base64"),
    );

    return Buffer.concat([
        decipher.update(Buffer.from(payload.value, "base64")),
        decipher.final(),
    ]).toString("utf8");
};

describe("Sanctum personal access token compatibility", () => {
    it("parses current and legacy plaintext token formats", () => {
        expect(parseSanctumPlainTextToken("42|token-secret")).toEqual({
            kind: "id",
            tokenId: "42",
            secret: "token-secret",
        });
        expect(parseSanctumPlainTextToken("legacy-token-secret")).toEqual({
            kind: "legacy",
            secret: "legacy-token-secret",
        });
    });

    it("verifies the secret against Laravel's stored SHA-256 hex digest", () => {
        const secret = "sanctum-token-secret";
        const storedHash = createHash("sha256")
            .update(secret, "utf8")
            .digest("hex");

        expect(hashSanctumTokenSecret(secret)).toBe(storedHash);
        expect(verifySanctumTokenSecret(secret, storedHash)).toBe(true);
        expect(verifySanctumTokenSecret("tampered-secret", storedHash)).toBe(
            false,
        );
        expect(verifySanctumTokenSecret(secret, "not-a-stored-hash")).toBe(
            false,
        );
    });

    it.each([
        "",
        "|secret",
        "0|secret",
        "01|secret",
        "not-an-id|secret",
        "1|",
        "9223372036854775808|secret",
    ])("rejects malformed id-based token %j", (plainTextToken: string) => {
        expect(() => parseSanctumPlainTextToken(plainTextToken)).toThrow(
            InvalidSanctumTokenFormatError,
        );
    });
});

describe("Laravel APP_KEY compatibility", () => {
    it("parses raw, padded base64, and unpadded base64 32-byte keys", () => {
        expect(parseLaravelAppKey(key.toString("utf8"))).toEqual(key);
        expect(parseLaravelAppKey(configuredKey)).toEqual(key);
        expect(
            parseLaravelAppKey(configuredKey.replace(/=$/u, "")),
        ).toEqual(key);
    });

    it.each([
        "",
        "too-short",
        "base64:not-base64!",
        `base64:${Buffer.alloc(31).toString("base64")}`,
        `base64:${Buffer.alloc(33).toString("base64")}`,
    ])("rejects an invalid key without exposing it: %j", (appKey: string) => {
        expect(() => parseLaravelAppKey(appKey)).toThrow(
            InvalidLaravelAppKeyError,
        );
    });
});

describe("Laravel AES-256-CBC Encrypter compatibility", () => {
    it("decrypts a deterministic Node crypto fixture", () => {
        const fixture = createLaravelFixture("existing-session-id");

        expect(decryptLaravelString(fixture, configuredKey)).toBe(
            "existing-session-id",
        );
    });

    it("decrypts a URL-encoded cookie payload", () => {
        const fixture = createLaravelFixture("cookie-value");

        expect(
            decryptLaravelString(encodeURIComponent(fixture), configuredKey),
        ).toBe("cookie-value");
    });

    it("encrypts a payload that an independent Node crypto path verifies", () => {
        const encrypted = encryptLaravelString("new-session-id", configuredKey);

        expect(independentlyDecryptLaravelPayload(encrypted)).toBe(
            "new-session-id",
        );
    });

    it("rejects MAC and ciphertext tampering with the same generic error", () => {
        const fixture = createLaravelFixture("authenticated-value");
        const macTampered = decodePayload(fixture);
        const valueTampered = decodePayload(fixture);
        macTampered.mac = `${macTampered.mac === "0".repeat(64) ? "1" : "0"}${macTampered.mac.slice(1)}`;
        valueTampered.value = `${valueTampered.value.startsWith("A") ? "B" : "A"}${valueTampered.value.slice(1)}`;

        for (const tampered of [macTampered, valueTampered]) {
            expect(() =>
                decryptLaravelString(encodePayload(tampered), configuredKey),
            ).toThrow(InvalidLaravelEncryptedPayloadError);
        }
    });

    it.each([
        "not-base64!",
        Buffer.from("not-json", "utf8").toString("base64"),
        Buffer.from("[]", "utf8").toString("base64"),
        "%invalid-url-encoding",
    ])("rejects malformed encrypted payload %j", (payload: string) => {
        expect(() => decryptLaravelString(payload, configuredKey)).toThrow(
            InvalidLaravelEncryptedPayloadError,
        );
    });

    it("clearly rejects unsupported AEAD payloads", () => {
        const payload = decodePayload(createLaravelFixture("value"));
        payload.tag = Buffer.alloc(16, 1).toString("base64");

        expect(() =>
            decryptLaravelString(encodePayload(payload), configuredKey),
        ).toThrow(UnsupportedLaravelEncryptedPayloadError);
    });

    it("clearly rejects PHP-serialized payload handling", () => {
        const payload = createLaravelFixture('s:10:"session-id";');

        expect(() =>
            decryptLaravelPayload(payload, configuredKey, "php-serialized"),
        ).toThrow(UnsupportedLaravelEncryptedPayloadError);
    });

    it("rejects a payload authenticated by a different APP_KEY", () => {
        const fixture = createLaravelFixture("value");
        const wrongKey = Buffer.from(
            "fedcba9876543210fedcba9876543210",
            "utf8",
        );

        expect(() => decryptLaravelString(fixture, wrongKey)).toThrow(
            InvalidLaravelEncryptedPayloadError,
        );
    });
});

describe("Laravel encrypted cookie compatibility", () => {
    const cookieName = "laravel_session";

    it("validates and removes Laravel's cookie value prefix", () => {
        const prefix = `${createHmac("sha1", key)
            .update(`${cookieName}v2`, "utf8")
            .digest("hex")}|`;
        const fixture = createLaravelFixture(`${prefix}database-session-id`);

        expect(
            decryptLaravelCookie(
                cookieName,
                encodeURIComponent(fixture),
                configuredKey,
            ),
        ).toBe("database-session-id");
        expect(() =>
            decryptLaravelCookie("another_cookie", fixture, configuredKey),
        ).toThrow(InvalidLaravelEncryptedPayloadError);
    });

    it("encrypts a cookie with the framework-compatible prefix", () => {
        const encrypted = encryptLaravelCookie(
            cookieName,
            "database-session-id",
            configuredKey,
        );
        const decrypted = independentlyDecryptLaravelPayload(encrypted);
        const expectedPrefix = `${createHmac("sha1", key)
            .update(`${cookieName}v2`, "utf8")
            .digest("hex")}|`;

        expect(decrypted).toBe(`${expectedPrefix}database-session-id`);
        expect(decryptLaravelCookie(cookieName, encrypted, configuredKey)).toBe(
            "database-session-id",
        );
    });

    it("decrypts cookies created before APP_KEY rotation", () => {
        const previousKey = configuredKey;
        const currentKey = `base64:${Buffer.from(
            "fedcba9876543210fedcba9876543210",
            "utf8",
        ).toString("base64")}`;
        const encrypted = encryptLaravelCookie(
            cookieName,
            "database-session-id",
            previousKey,
        );
        const keys = parseLaravelAppKeys(currentKey, previousKey);

        expect(
            decryptLaravelCookieWithKeys(cookieName, encrypted, keys),
        ).toBe("database-session-id");
    });
});

describe("Laravel bcrypt password compatibility", () => {
    it("verifies Laravel's $2y$ hashes without changing the stored value", async () => {
        const generatedHash = await hash("correct horse battery staple", 4);
        const laravelHash = `$2y$${generatedHash.slice(4)}`;

        expect(isLaravelBcryptHash(laravelHash)).toBe(true);
        await expect(
            verifyLaravelPassword("correct horse battery staple", laravelHash),
        ).resolves.toBe(true);
        await expect(
            verifyLaravelPassword("wrong password", laravelHash),
        ).resolves.toBe(false);
    });

    it("fails closed for malformed or unsupported hashes", async () => {
        await expect(
            verifyLaravelPassword("password", "$argon2id$unsupported"),
        ).resolves.toBe(false);
        await expect(
            verifyLaravelPassword("password", "not-a-hash"),
        ).resolves.toBe(false);
    });
});

describe("Laravel database session compatibility", () => {
    it("resolves an active session through its indexed user ID", async () => {
        const sessionId = "A".repeat(40);
        const encrypted = encryptLaravelCookie(
            "relaticle_session",
            sessionId,
            configuredKey,
        );

        await expect(
            resolveLegacySession(
                {
                    cookieName: "relaticle_session",
                    encryptedCookieValue: encrypted,
                    appKeys: [key],
                    lifetimeMinutes: 120,
                    now: new Date("2026-08-18T12:00:00Z"),
                },
                async (requestedId) => ({
                    id: requestedId,
                    userId: "01J00000000000000000000000",
                    lastActivity: Date.parse("2026-08-18T11:00:00Z") / 1_000,
                }),
            ),
        ).resolves.toEqual({
            sessionId,
            userId: "01J00000000000000000000000",
        });
    });

    it("rejects expired, unauthenticated, and malformed sessions", async () => {
        const encrypted = encryptLaravelCookie(
            "relaticle_session",
            "A".repeat(40),
            configuredKey,
        );
        const input = {
            cookieName: "relaticle_session",
            encryptedCookieValue: encrypted,
            appKeys: [key],
            lifetimeMinutes: 120,
            now: new Date("2026-08-18T12:00:00Z"),
        } as const;

        await expect(
            resolveLegacySession(input, async (id) => ({
                id,
                userId: "01J00000000000000000000000",
                lastActivity: Date.parse("2026-08-18T09:59:59Z") / 1_000,
            })),
        ).resolves.toBeUndefined();
        await expect(
            resolveLegacySession(input, async (id) => ({
                id,
                userId: null,
                lastActivity: Date.parse("2026-08-18T11:00:00Z") / 1_000,
            })),
        ).resolves.toBeUndefined();
        await expect(
            resolveLegacySession(
                { ...input, encryptedCookieValue: "tampered" },
                async () => undefined,
            ),
        ).resolves.toBeUndefined();
    });
});
