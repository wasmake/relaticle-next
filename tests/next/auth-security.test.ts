import { describe, expect, it } from "vitest";

import type {
    FixedWindowRateLimitResult,
    FixedWindowRateLimitStore,
    RateLimitBucket,
} from "@/server/api/rate-limiter";
import { applicationUrl } from "@/server/auth/application-url";
import {
    consumeTwoFactorChallenge,
    type OneTimeChallengeStore,
} from "@/server/auth/browser/challenge";
import { AuthenticationRateLimiter } from "@/server/auth/rate-limiter";
import { encodeBase32, totpCode, totpStep } from "@/server/auth/totp";
import { parseEnvironment } from "@/server/env";

class MemoryRateLimitStore implements FixedWindowRateLimitStore {
    public readonly attempts = new Map<string, number>();
    public buckets: readonly RateLimitBucket[] = [];

    public async consume(
        buckets: readonly RateLimitBucket[],
        windowSeconds: number,
        nowEpochSeconds: number,
    ): Promise<FixedWindowRateLimitResult> {
        this.buckets = buckets;
        const states = buckets.map((bucket) => {
            const attempts = (this.attempts.get(bucket.key) ?? 0) + 1;
            this.attempts.set(bucket.key, attempts);
            return { ...bucket, attempts, resetAt: nowEpochSeconds + windowSeconds };
        });
        const blockedBucketIndex = states.findIndex(({ attempts, limit }) => attempts > limit);
        return { allowed: blockedBucketIndex === -1, blockedBucketIndex: blockedBucketIndex === -1 ? null : blockedBucketIndex, buckets: states };
    }
}

class MemoryChallengeStore implements OneTimeChallengeStore {
    private readonly consumed = new Set<string>();

    public async consume(key: string): Promise<boolean> {
        if (this.consumed.has(key)) return false;
        this.consumed.add(key);
        return true;
    }
}

describe("authentication security controls", () => {
    it("builds reset links from the validated configured application origin", () => {
        const environment = parseEnvironment({ APP_URL: "https://crm.example.test/untrusted-base" });
        const url = applicationUrl("/app/password-reset", environment);
        expect(url.toString()).toBe("https://crm.example.test/app/password-reset");
        expect(() => parseEnvironment({ APP_URL: "javascript:alert(1)" })).toThrow();
    });

    it("rate limits authentication by both trusted client IP and hashed account", async () => {
        const store = new MemoryRateLimitStore();
        const limiter = new AuthenticationRateLimiter(store, () => new Date("2026-08-19T12:00:00Z"));
        const headers = new Headers({ "x-forwarded-for": "192.0.2.10" });

        for (let attempt = 0; attempt < 10; attempt += 1) {
            await expect(limiter.consume("login", headers, "Ada@Example.Test")).resolves.toBe(true);
        }
        await expect(limiter.consume("login", headers, "ada@example.test")).resolves.toBe(false);
        expect(store.buckets).toHaveLength(2);
        expect(store.buckets.map(({ key }) => key).join(" ")).not.toContain("ada@example.test");
    });

    it("consumes a two-factor challenge nonce only once", async () => {
        const store = new MemoryChallengeStore();
        await expect(consumeTwoFactorChallenge("challenge-nonce", store)).resolves.toBe(true);
        await expect(consumeTwoFactorChallenge("challenge-nonce", store)).resolves.toBe(false);
    });

    it("identifies the exact TOTP step so callers can reject step replay", () => {
        const secret = encodeBase32(Buffer.from("12345678901234567890", "ascii"));
        const time = 59_000;
        expect(totpStep(secret, totpCode(secret, time), time)).toBe(Math.floor(time / 30_000));
    });
});
