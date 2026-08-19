import { randomUUID } from "node:crypto";

import type Redis from "ioredis";

import { getLaravelRedisPrefix } from "@/server/env";
import type { ChatIdentity } from "./types";

export type ChatTurnLease = Readonly<{ key: string; token: string }>;

export interface ChatTurnLock {
    acquire(identity: ChatIdentity, conversationId: string): Promise<ChatTurnLease | undefined>;
    release(lease: ChatTurnLease): Promise<void>;
}

export class LocalChatTurnLock implements ChatTurnLock {
    private readonly active = new Map<string, string>();

    public async acquire(identity: ChatIdentity, conversationId: string): Promise<ChatTurnLease | undefined> {
        const key = `${identity.teamId}:${identity.userId}:${conversationId}`;
        if (this.active.has(key)) return undefined;
        const token = randomUUID();
        this.active.set(key, token);
        return { key, token };
    }

    public async release(lease: ChatTurnLease): Promise<void> {
        if (this.active.get(lease.key) === lease.token) this.active.delete(lease.key);
    }
}

export class RedisChatTurnLock implements ChatTurnLock {
    public constructor(private readonly redis: Redis, private readonly ttlMs = 10 * 60_000) {}

    public async acquire(identity: ChatIdentity, conversationId: string): Promise<ChatTurnLease | undefined> {
        const key = `${getLaravelRedisPrefix()}chat_turn:${identity.teamId}:${identity.userId}:${conversationId}`;
        const token = randomUUID();
        return await this.redis.set(key, token, "PX", this.ttlMs, "NX") === "OK" ? { key, token } : undefined;
    }

    public async release(lease: ChatTurnLease): Promise<void> {
        await this.redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, lease.key, lease.token);
    }
}
