import { createHash } from "node:crypto";

import type { HttpAuthIdentitySuccess } from "@/server/auth/http";
import {
    getEnvironment,
    getLaravelCachePrefix,
    getLaravelRedisPrefix,
    type Environment,
} from "@/server/env";
import { resolveClientIp } from "@/server/http/client-ip";
import { getCacheRedisClient } from "@/server/redis/client";

export type RateLimitBucket = Readonly<{
    key: string;
    limit: number;
}>;

export type RateLimitBucketState = RateLimitBucket &
    Readonly<{
        attempts: number;
        resetAt: number;
    }>;

export type FixedWindowRateLimitResult = Readonly<{
    allowed: boolean;
    blockedBucketIndex: number | null;
    buckets: readonly RateLimitBucketState[];
}>;

export interface FixedWindowRateLimitStore {
    consume(
        buckets: readonly RateLimitBucket[],
        windowSeconds: number,
        nowEpochSeconds: number,
    ): Promise<FixedWindowRateLimitResult>;
}

export type ApiRateLimitResult = Readonly<{
    allowed: boolean;
    headers: Readonly<Record<string, string>>;
}>;

const rateLimitScript = `
local bucketCount = #KEYS / 2
local window = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local counts = {}
local resets = {}
local blocked = 0

for index = 1, bucketCount do
    local counterKey = KEYS[(index - 1) * 2 + 1]
    local timerKey = KEYS[(index - 1) * 2 + 2]
    local limit = tonumber(ARGV[index + 2])
    local count = tonumber(redis.call('GET', counterKey)) or 0
    local resetAt = tonumber(redis.call('GET', timerKey)) or 0

    if resetAt ~= 0 and resetAt <= now then
        redis.call('DEL', counterKey, timerKey)
        count = 0
        resetAt = 0
    end

    counts[index] = count
    resets[index] = resetAt

    if blocked == 0 and count >= limit and resetAt > now then
        blocked = index
    end
end

if blocked == 0 then
    for index = 1, bucketCount do
        local counterKey = KEYS[(index - 1) * 2 + 1]
        local timerKey = KEYS[(index - 1) * 2 + 2]
        local resetAt = resets[index]

        if resetAt == 0 then
            resetAt = now + window
            redis.call('SET', timerKey, resetAt, 'EX', window, 'NX')
            resetAt = tonumber(redis.call('GET', timerKey)) or resetAt
        end

        if redis.call('EXISTS', counterKey) == 0 then
            redis.call('SET', counterKey, 0, 'EX', window, 'NX')
        end

        counts[index] = redis.call('INCR', counterKey)
        resets[index] = resetAt
    end
end

local result = {blocked == 0 and 1 or 0, blocked}
for index = 1, bucketCount do
    table.insert(result, counts[index])
    table.insert(result, resets[index])
end

return result
`;

const rateLimitHash = (key: string): string =>
    createHash("md5").update(`api${key}`).digest("hex");

export class RedisFixedWindowRateLimitStore implements FixedWindowRateLimitStore {
    public constructor(
        private readonly environment: Environment = getEnvironment(),
        private readonly redis = getCacheRedisClient(),
    ) {}

    public async consume(
        buckets: readonly RateLimitBucket[],
        windowSeconds: number,
        nowEpochSeconds: number,
    ): Promise<FixedWindowRateLimitResult> {
        const prefix = `${getLaravelRedisPrefix(this.environment)}${getLaravelCachePrefix(this.environment)}`;
        const keys = buckets.flatMap(({ key }) => {
            const counterKey = `${prefix}${rateLimitHash(key)}`;

            return [counterKey, `${counterKey}:timer`];
        });
        const rawResult = await this.redis.eval(
            rateLimitScript,
            keys.length,
            ...keys,
            windowSeconds,
            nowEpochSeconds,
            ...buckets.map(({ limit }) => limit),
        );

        if (!Array.isArray(rawResult) || rawResult.length !== 2 + buckets.length * 2) {
            throw new Error("Redis returned an invalid API rate-limit result.");
        }

        const values = rawResult.map(Number);
        const allowed = values[0] === 1;
        const blockedIndex = values[1];

        if (
            values.some((value) => !Number.isFinite(value)) ||
            blockedIndex === undefined
        ) {
            throw new Error("Redis returned an invalid API rate-limit result.");
        }

        return {
            allowed,
            blockedBucketIndex: allowed ? null : blockedIndex - 1,
            buckets: buckets.map((bucket, index) => ({
                ...bucket,
                attempts: values[2 + index * 2] ?? 0,
                resetAt: values[3 + index * 2] ?? nowEpochSeconds,
            })),
        };
    }
}

const exposedBucket = (
    result: FixedWindowRateLimitResult,
): RateLimitBucketState => {
    if (!result.allowed && result.blockedBucketIndex !== null) {
        const blocked = result.buckets[result.blockedBucketIndex];

        if (blocked !== undefined) {
            return blocked;
        }
    }

    const sorted = [...result.buckets].sort(
        (left, right) =>
            left.limit - left.attempts - (right.limit - right.attempts),
    );
    const bucket = sorted[0];

    if (bucket === undefined) {
        throw new Error("API rate limiting requires at least one bucket.");
    }

    return bucket;
};

export class ApiRateLimiter {
    public constructor(
        private readonly store: FixedWindowRateLimitStore,
        private readonly now: () => Date = () => new Date(),
        private readonly clientIp: typeof resolveClientIp = resolveClientIp,
    ) {}

    public async consume(
        request: Pick<Request, "headers" | "method">,
        identity: HttpAuthIdentitySuccess,
    ): Promise<ApiRateLimitResult> {
        const fallback = this.clientIp(request.headers);
        const credentialKey =
            identity.credential.kind === "personal_access_token"
                ? identity.credential.token.tokenId
                : fallback;
        const isRead = request.method.toUpperCase() === "GET";
        const buckets = [
            {
                key: `team:${identity.currentTeamId ?? fallback}`,
                limit: 600,
            },
            {
                key: `token:${credentialKey}:${isRead ? "read" : "write"}`,
                limit: isRead ? 300 : 60,
            },
        ] as const;
        const nowEpochSeconds = Math.floor(this.now().getTime() / 1_000);
        const result = await this.store.consume(buckets, 60, nowEpochSeconds);
        const exposed = exposedBucket(result);
        const headers: Record<string, string> = {
            "x-ratelimit-limit": String(exposed.limit),
            "x-ratelimit-remaining": String(
                Math.max(0, exposed.limit - exposed.attempts),
            ),
        };

        if (!result.allowed) {
            headers["retry-after"] = String(
                Math.max(0, exposed.resetAt - nowEpochSeconds),
            );
            headers["x-ratelimit-reset"] = String(exposed.resetAt);
        }

        return { allowed: result.allowed, headers };
    }
}
