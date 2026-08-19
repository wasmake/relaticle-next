import { Redis } from "ioredis";

import { getSchedulerProcessContract } from "./config.js";
import {
    createSchedulerSqlClient,
    PostgresCleanupRepository,
} from "./database.js";
import type { SchedulerEnvironment } from "./environment.js";
import {
    createCleanupHandlerRegistry,
    unimplementedScheduleHandlers,
} from "./handlers.js";
import { RedisDistributedLock } from "./lock.js";
import { ProductionScheduleOperations } from "./operations.js";
import { SchedulerRuntime } from "./runtime.js";

export type ProductionSchedulerRuntime = Readonly<{
    scheduler: SchedulerRuntime;
    unimplementedHandlers: readonly string[];
    close: () => Promise<void>;
    start: () => void;
    isReady: () => boolean;
}>;

const createRedis = (environment: SchedulerEnvironment): Redis => {
    const options = {
        lazyConnect: true,
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        db: environment.REDIS_DB,
    } as const;

    return environment.REDIS_URL
        ? new Redis(environment.REDIS_URL, options)
        : new Redis({
              ...options,
              host: environment.REDIS_HOST,
              port: environment.REDIS_PORT,
              username: environment.REDIS_USERNAME,
              password: environment.REDIS_PASSWORD,
          });
};

const closeRedis = async (redis: Redis): Promise<void> => {
    if (redis.status === "wait" || redis.status === "end") {
        redis.disconnect();
        return;
    }

    await redis.quit();
};

export const createProductionScheduler = async (
    environment: SchedulerEnvironment,
    source: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ProductionSchedulerRuntime> => {
    const contract = getSchedulerProcessContract(source);
    const sql = createSchedulerSqlClient(environment);
    const redis = createRedis(environment);

    try {
        await Promise.all([
            sql`select 1`,
            redis.connect().then(async () => redis.ping()),
        ]);
    } catch (error) {
        await Promise.allSettled([sql.end(), closeRedis(redis)]);
        throw error;
    }

    const repository = new PostgresCleanupRepository(
        sql,
        environment.CSV_IMPORTS_PATH,
    );
    const handlers = createCleanupHandlerRegistry(
        repository,
        new ProductionScheduleOperations(sql, redis, environment),
    );
    const unimplementedHandlers = unimplementedScheduleHandlers(
        contract.jobs.map(({ jobKey }) => jobKey),
        handlers,
    );
    const lockPrefix = `${environment.REDIS_PREFIX}scheduler:lock`;
    const scheduler = new SchedulerRuntime({
        jobs: contract.jobs,
        timeZone: contract.timeZone,
        handlers,
        lock: new RedisDistributedLock(redis, lockPrefix),
        operationDeadlineMilliseconds: environment.SCHEDULER_OPERATION_TIMEOUT_MS,
    });
    let closed = false;
    let started = false;
    let heartbeatHealthy = true;
    let heartbeat: NodeJS.Timeout | undefined;

    const renewHeartbeat = async (): Promise<void> => {
        await redis.set(`${environment.REDIS_PREFIX}scheduler:heartbeat`, Math.floor(Date.now() / 1_000).toString(), "EX", 120);
        heartbeatHealthy = true;
    };

    return {
        scheduler,
        unimplementedHandlers,
        start: () => {
            if (started) throw new Error("Scheduler has already been started.");
            started = true;
            scheduler.start();
            void renewHeartbeat().catch(() => { heartbeatHealthy = false; });
            heartbeat = setInterval(() => { void renewHeartbeat().catch(() => { heartbeatHealthy = false; }); }, 30_000);
            heartbeat.unref();
        },
        isReady: () => started && !closed && heartbeatHealthy,
        close: async () => {
            if (closed) {
                return;
            }

            closed = true;
            if (heartbeat !== undefined) clearInterval(heartbeat);
            await scheduler.stop();
            await sql.end();
            await closeRedis(redis);
        },
    };
};
