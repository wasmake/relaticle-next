import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { mailcoachTagFor } from "@/server/accounts/mailcoach";
import { authorizationUrl, createPkce, fetchSocialProfile, oauthRedirectUri, readSocialOAuthFlow } from "@/server/auth/oauth";
import { encodeBase32, totpCode, verifyTotp } from "@/server/auth/totp";
import { verifyTurnstile } from "@/server/auth/turnstile";
import { resolveLegacySession } from "@/server/auth/compatibility/legacy-session";
import { encryptLaravelCookie } from "@/server/auth/compatibility/laravel-encrypter";
import { parseEnvironment } from "@/server/env";

describe("authentication integration primitives", () => {
    it("implements the RFC 6238 SHA-1 vector and accepts bounded clock skew", () => {
        const secret = encodeBase32(Buffer.from("12345678901234567890", "ascii"));
        expect(totpCode(secret, 59_000)).toBe("287082");
        expect(verifyTotp(secret, "287082", 59_000)).toBe(true);
        expect(verifyTotp(secret, "287082", 120_000)).toBe(false);
    });

    it("creates an S256 PKCE verifier and challenge", () => {
        const value = createPkce();
        expect(value.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/u);
        expect(value.challenge).toBe(createHash("sha256").update(value.verifier).digest("base64url"));
    });

    it("uses the configured public callback and sends state plus S256 PKCE", () => {
        const environment = parseEnvironment({ APP_URL: "https://crm.example.test/base", GOOGLE_CLIENT_ID: "google-id", GOOGLE_CLIENT_SECRET: "google-secret" });
        const redirectUri = oauthRedirectUri("google", environment);
        const destination = new URL(authorizationUrl("google", redirectUri, "state-value", "challenge-value", environment) ?? "");
        expect(redirectUri).toBe("https://crm.example.test/auth/oauth/google/callback");
        expect(destination.searchParams.get("redirect_uri")).toBe(redirectUri);
        expect(destination.searchParams.get("state")).toBe("state-value");
        expect(destination.searchParams.get("code_challenge_method")).toBe("S256");
    });

    it("rejects OAuth flow cookies when provider or state does not match", () => {
        const saved = { provider: "github", state: "expected", verifier: "verifier", next: "/app/team" } as const;
        expect(readSocialOAuthFlow("github", "expected", saved)).toEqual({ provider: "github", verifier: "verifier", next: "/app/team" });
        expect(readSocialOAuthFlow("google", "expected", saved)).toBeUndefined();
        expect(readSocialOAuthFlow("github", "different", saved)).toBeUndefined();
        expect(readSocialOAuthFlow("github", null, saved)).toBeUndefined();
    });

    it("accepts only a verified GitHub email from the email endpoint", async () => {
        const environment = parseEnvironment({ GITHUB_CLIENT_ID: "github-id", GITHUB_CLIENT_SECRET: "github-secret" });
        const request = async (input: string | URL | Request): Promise<Response> => {
            const url = String(input);
            if (url.includes("access_token")) return Response.json({ access_token: "token" });
            if (url.endsWith("/user")) return Response.json({ id: 42, login: "ada", email: "private@example.test" });
            return Response.json([
                { email: "unverified@example.test", primary: true, verified: false },
                { email: "verified@example.test", primary: false, verified: true },
            ]);
        };
        await expect(fetchSocialProfile("github", "code", "verifier", "https://crm.example.test/callback", request as typeof fetch, environment)).resolves.toEqual({
            id: "42", email: "verified@example.test", name: "ada", emailVerified: true,
        });
    });

    it("binds successful Turnstile tokens to the configured application host", async () => {
        const environment = parseEnvironment({ APP_URL: "https://crm.example.test", TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "secret" });
        const valid = async () => Response.json({ success: true, hostname: "crm.example.test" });
        const wrongHost = async () => Response.json({ success: true, hostname: "attacker.example" });
        await expect(verifyTurnstile("token", "192.0.2.1", valid as typeof fetch, environment)).resolves.toBe(true);
        await expect(verifyTurnstile("token", null, wrongHost as typeof fetch, environment)).resolves.toBe(false);
    });

    it("maps lifecycle hooks to stable Mailcoach tags", () => {
        expect(["registration", "login", "team", "first-data", "first-token", "first-chat"].map((event) => mailcoachTagFor(event as Parameters<typeof mailcoachTagFor>[0]))).toEqual(["registered", "logged-in", "has-team", "created-first-data", "created-first-token", "started-first-chat"]);
    });

    it("validates paired external credentials", () => {
        expect(() => parseEnvironment({ GITHUB_CLIENT_ID: "client" })).toThrow(/GITHUB_CLIENT_SECRET/u);
        expect(() => parseEnvironment({ TURNSTILE_SITE_KEY: "site" })).toThrow(/TURNSTILE_SECRET_KEY/u);
        expect(() => parseEnvironment({ MAIL_MAILER: "resend" })).toThrow(/RESEND_KEY/u);
        expect(parseEnvironment({ GITHUB_CLIENT_ID: "client", GITHUB_CLIENT_SECRET: "secret", TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "secret" }).REMEMBER_ME_DAYS).toBe(30);
    });
});

describe("remembered browser sessions", () => {
    const key = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
    const configuredKey = `base64:${key.toString("base64")}`;
    const sessionId = "R".repeat(40);
    const cookie = encryptLaravelCookie("relaticle_session", sessionId, configuredKey);

    it("accepts an idle first-party session until remember expiry", async () => {
        await expect(resolveLegacySession({ cookieName: "relaticle_session", encryptedCookieValue: cookie, appKeys: [key], lifetimeMinutes: 120, now: new Date("2026-08-19T12:00:00Z") }, async () => ({ id: sessionId, userId: "01J00000000000000000000000", lastActivity: Date.parse("2026-08-01T12:00:00Z") / 1_000, payload: `relaticle:${JSON.stringify({ rememberUntil: Date.parse("2026-08-20T12:00:00Z") / 1_000 })}` }))).resolves.toEqual({ sessionId, userId: "01J00000000000000000000000" });
    });

    it("rejects the same session after remember expiry", async () => {
        await expect(resolveLegacySession({ cookieName: "relaticle_session", encryptedCookieValue: cookie, appKeys: [key], lifetimeMinutes: 120, now: new Date("2026-08-21T12:00:00Z") }, async () => ({ id: sessionId, userId: "01J00000000000000000000000", lastActivity: Date.parse("2026-08-01T12:00:00Z") / 1_000, payload: `relaticle:${JSON.stringify({ rememberUntil: Date.parse("2026-08-20T12:00:00Z") / 1_000 })}` }))).resolves.toBeUndefined();
    });
});
