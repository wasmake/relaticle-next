import { createHash } from "node:crypto";

import {
    RedisFixedWindowRateLimitStore,
    type FixedWindowRateLimitStore,
} from "@/server/api/rate-limiter";
import { resolveClientIp } from "@/server/http/client-ip";

export type AuthenticationRateLimitScope = "login" | "two-factor" | "sysadmin";

const limits: Readonly<Record<AuthenticationRateLimitScope, Readonly<{ account: number; ip: number }>>> = {
    login: { account: 10, ip: 50 },
    "two-factor": { account: 10, ip: 50 },
    sysadmin: { account: 5, ip: 20 },
};

const digest = (value: string): string =>
    createHash("sha256").update(value.trim().toLowerCase()).digest("hex");

export class AuthenticationRateLimiter {
    public constructor(
        private readonly store: FixedWindowRateLimitStore = new RedisFixedWindowRateLimitStore(),
        private readonly now: () => Date = () => new Date(),
    ) {}

    public async consume(
        scope: AuthenticationRateLimitScope,
        headers: Pick<Headers, "get">,
        account: string,
    ): Promise<boolean> {
        const limit = limits[scope];
        const result = await this.store.consume([
            { key: `auth:${scope}:ip:${resolveClientIp(headers)}`, limit: limit.ip },
            { key: `auth:${scope}:account:${digest(account)}`, limit: limit.account },
        ], 60, Math.floor(this.now().getTime() / 1_000));
        return result.allowed;
    }
}

export const authenticationRateLimiter = new AuthenticationRateLimiter();
