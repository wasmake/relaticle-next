import { Queue, type Worker } from "bullmq";
import { Redis } from "ioredis";

import {
    chatProcessJobName,
    csvExportJobName,
    csvImportJobName,
    genericEmailJobNames,
    mailcoachRecencySyncJobName,
    mailcoachSubscriberSyncJobName,
    mailcoachTagsModifyJobName,
    taskAssigneeEmailJobName,
    taskAssigneesAddedJobName,
} from "../../packages/queue/src/jobs.js";
import { resolveQueueContracts } from "../../packages/queue/src/queues.js";
import { createWorkerSqlClient, type WorkerSqlClient } from "./database.js";
import type { WorkerEnvironment } from "./environment.js";
import { createProductionApplicationOperations } from "./application-composition.js";
import { createDurableProcessors } from "./jobs/durable-jobs.js";
import {
    ProductionOutboundOperations,
} from "./jobs/outbound-operations.js";
import {
    LogTaskAssignmentEmailTransport,
    ResendTaskAssignmentEmailTransport,
    TaskAssigneeEmailProcessor,
    type TaskAssignmentEmailTransport,
} from "./jobs/task-assignee-email.js";
import { TaskAssigneesAddedProcessor } from "./jobs/task-assignees-added.js";
import { PostgresTaskNotificationRepository } from "./task-notification-repository.js";
import {
    assertCompleteProcessorRegistry,
    createQueueWorker,
    type HealthSignalWriter,
    type QueueProcessors,
} from "./worker.js";

export type ProductionWorkerRuntime = Readonly<{
    workers: readonly Worker[];
    run: () => Promise<void>;
    close: () => Promise<void>;
    isReady: () => boolean;
}>;

const createRedis = (environment: WorkerEnvironment): Redis => {
    const options = { lazyConnect: true, maxRetriesPerRequest: null, enableReadyCheck: true, db: environment.REDIS_DB } as const;
    return environment.REDIS_URL ? new Redis(environment.REDIS_URL, options) : new Redis({
        ...options, host: environment.REDIS_HOST, port: environment.REDIS_PORT,
        username: environment.REDIS_USERNAME, password: environment.REDIS_PASSWORD,
    });
};

const emailTransport = (environment: WorkerEnvironment): TaskAssignmentEmailTransport => {
    if (environment.MAIL_MAILER === "log") return new LogTaskAssignmentEmailTransport();
    if (environment.RESEND_KEY === undefined) throw new Error("RESEND_KEY is required when MAIL_MAILER=resend.");
    return new ResendTaskAssignmentEmailTransport(environment.RESEND_KEY, environment.MAIL_FROM_ADDRESS, environment.MAIL_FROM_NAME);
};

const closeRedis = async (redis: Redis): Promise<void> => {
    if (redis.status === "wait" || redis.status === "end") { redis.disconnect(); return; }
    await redis.quit();
};

const assertDatabaseReady = async (sql: WorkerSqlClient): Promise<void> => { await sql`select 1`; };

export const createProductionWorker = async (
    environment: WorkerEnvironment,
): Promise<ProductionWorkerRuntime> => {
    const contracts = resolveQueueContracts(process.env);
    const sql = createWorkerSqlClient(environment);
    const redis = createRedis(environment);
    try {
        await Promise.all([assertDatabaseReady(sql), redis.connect().then(async () => redis.ping())]);
    } catch (error) {
        await Promise.allSettled([sql.end(), closeRedis(redis)]);
        throw error;
    }

    const defaultContract = contracts.find(({ name }) => name === "default");
    if (defaultContract === undefined) throw new Error("The default queue contract is missing.");
    const emailQueue = new Queue("default", {
        connection: redis, prefix: environment.BULLMQ_PREFIX,
        defaultJobOptions: {
            attempts: defaultContract.defaultMaxAttempts,
            backoff: { type: "exponential", delay: 1_000 },
            removeOnComplete: { age: 86_400, count: 1_000 }, removeOnFail: { age: 604_800, count: 5_000 },
        },
    });
    const repository = new PostgresTaskNotificationRepository(sql);
    const applicationOperations = createProductionApplicationOperations(sql, environment, emailQueue);
    const durable = createDurableProcessors(new ProductionOutboundOperations(sql, environment, applicationOperations));
    const processors: Record<string, QueueProcessors[string]> = {
        [taskAssigneesAddedJobName]: { process: (input) => new TaskAssigneesAddedProcessor(repository, emailQueue, {
            appUrl: environment.APP_URL, appPanelPath: environment.APP_PANEL_PATH,
            ...(environment.APP_PANEL_DOMAIN === undefined ? {} : { appPanelDomain: environment.APP_PANEL_DOMAIN }),
        }).process(input) },
        [taskAssigneeEmailJobName]: { process: (input) => new TaskAssigneeEmailProcessor(emailTransport(environment)).process(input) },
        [csvExportJobName]: durable.csvExport,
        [csvImportJobName]: durable.csvImport,
        [chatProcessJobName]: durable.chatProcess,
        [mailcoachSubscriberSyncJobName]: durable.mailcoachSubscriber,
        [mailcoachTagsModifyJobName]: durable.mailcoachTags,
        [mailcoachRecencySyncJobName]: durable.mailcoachRecency,
    };
    for (const name of genericEmailJobNames) processors[name] = durable.email;
    assertCompleteProcessorRegistry(processors);

    const health: HealthSignalWriter = async (signal) => {
        await redis.set(`${environment.REDIS_PREFIX}health:worker:${signal.queue}`, JSON.stringify(signal), "EX", 180);
    };
    const workers = contracts.map((contract) => createQueueWorker(redis, environment.BULLMQ_PREFIX, contract, processors, health));
    let heartbeatHealthy = true;
    const writeIdleHeartbeats = async (): Promise<void> => {
        const at = new Date().toISOString();
        await Promise.all(contracts.map(({ name }) => health({ queue: name, state: "ready", at })));
        heartbeatHealthy = true;
    };
    await writeIdleHeartbeats();
    const heartbeat = setInterval(() => { void writeIdleHeartbeats().catch((error: unknown) => {
        heartbeatHealthy = false;
        console.error("Worker heartbeat failed", { error: error instanceof Error ? error.message : "Unknown error" });
    }); }, 30_000);
    heartbeat.unref();
    let closed = false;
    return {
        workers,
        run: async () => { await Promise.all(workers.map(async (worker) => worker.run())); },
        close: async () => {
            if (closed) return;
            closed = true;
            clearInterval(heartbeat);
            await Promise.allSettled(workers.map(async (worker) => worker.close(false)));
            await emailQueue.close();
            await sql.end();
            await closeRedis(redis);
        },
        isReady: () => !closed && heartbeatHealthy && workers.every((worker) => worker.isRunning()),
    };
};
