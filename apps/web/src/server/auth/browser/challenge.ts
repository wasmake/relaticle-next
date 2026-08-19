import { createHash } from "node:crypto";

import { getCacheRedisClient } from "@/server/redis/client";

export interface OneTimeChallengeStore {
    consume(key: string, lifetimeSeconds: number): Promise<boolean>;
}

export class RedisOneTimeChallengeStore implements OneTimeChallengeStore {
    public constructor(private readonly redis = getCacheRedisClient()) {}

    public async consume(key: string, lifetimeSeconds: number): Promise<boolean> {
        return (await this.redis.set(key, "1", "EX", lifetimeSeconds, "NX")) === "OK";
    }
}

const challengeKey = (nonce: string): string =>
    `auth:2fa:challenge:${createHash("sha256").update(nonce).digest("hex")}`;

export const consumeTwoFactorChallenge = (
    nonce: string,
    store: OneTimeChallengeStore = new RedisOneTimeChallengeStore(),
): Promise<boolean> => store.consume(challengeKey(nonce), 600);
