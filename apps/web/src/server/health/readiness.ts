import { getSqlClient } from "@/server/db/client";
import { getEnvironment } from "@/server/env";
import { getRedisClient } from "@/server/redis/client";

type DependencyName = "database" | "redis";
type DependencyStatus = "up" | "down";

type DependencyResult = Readonly<{
    status: DependencyStatus;
    latencyMs: number;
}>;

export type ReadinessReport = Readonly<{
    status: "ready" | "unavailable";
    checks: Record<DependencyName, DependencyResult>;
}>;

export type ReadinessChecks = Readonly<
    Record<DependencyName, () => Promise<void>>
>;

const defaultChecks: ReadinessChecks = {
    database: async (): Promise<void> => {
        await getSqlClient()`select 1`;
    },
    redis: async (): Promise<void> => {
        const redis = getRedisClient();

        if (redis.status === "wait") {
            await redis.connect();
        }

        await redis.ping();
    },
};

const runCheck = async (
    check: () => Promise<void>,
    timeoutMs: number,
): Promise<DependencyResult> => {
    const startedAt = performance.now();
    let timeout: NodeJS.Timeout | undefined;

    try {
        await Promise.race([
            check(),
            new Promise<never>((_resolve, reject): void => {
                timeout = setTimeout(
                    () => reject(new Error("Health check timed out")),
                    timeoutMs,
                );
            }),
        ]);

        return {
            status: "up",
            latencyMs: Math.round(performance.now() - startedAt),
        };
    } catch {
        return {
            status: "down",
            latencyMs: Math.round(performance.now() - startedAt),
        };
    } finally {
        if (timeout !== undefined) {
            clearTimeout(timeout);
        }
    }
};

export const buildReadinessReport = async (
    checks: ReadinessChecks = defaultChecks,
    timeoutMs: number = getEnvironment().HEALTH_CHECK_TIMEOUT_MS,
): Promise<ReadinessReport> => {
    const [database, redis] = await Promise.all([
        runCheck(checks.database, timeoutMs),
        runCheck(checks.redis, timeoutMs),
    ]);
    const ready = database.status === "up" && redis.status === "up";

    return {
        status: ready ? "ready" : "unavailable",
        checks: { database, redis },
    };
};
