import { Queue, type Worker } from "bullmq";
import { Redis } from "ioredis";

import { queueContracts } from "../../packages/queue/src/queues.js";
import { createWorkerSqlClient, type WorkerSqlClient } from "./database.js";
import type { WorkerEnvironment } from "./environment.js";
import {
    LogTaskAssignmentEmailTransport,
    ResendTaskAssignmentEmailTransport,
    TaskAssigneeEmailProcessor,
    type TaskAssignmentEmailTransport,
} from "./jobs/task-assignee-email.js";
import { TaskAssigneesAddedProcessor } from "./jobs/task-assignees-added.js";
import { PostgresTaskNotificationRepository } from "./task-notification-repository.js";
import { createDefaultQueueWorker } from "./worker.js";

export type ProductionWorkerRuntime = Readonly<{
    worker: Worker;
    close: () => Promise<void>;
}>;

const createRedis = (environment: WorkerEnvironment): Redis => {
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

const emailTransport = (
    environment: WorkerEnvironment,
): TaskAssignmentEmailTransport => {
    if (environment.MAIL_MAILER === "log") {
        return new LogTaskAssignmentEmailTransport();
    }

    if (environment.RESEND_KEY === undefined) {
        throw new Error("RESEND_KEY is required when MAIL_MAILER=resend.");
    }

    return new ResendTaskAssignmentEmailTransport(
        environment.RESEND_KEY,
        environment.MAIL_FROM_ADDRESS,
        environment.MAIL_FROM_NAME,
    );
};

const closeRedis = async (redis: Redis): Promise<void> => {
    if (redis.status === "wait" || redis.status === "end") {
        redis.disconnect();

        return;
    }

    await redis.quit();
};

const assertDatabaseReady = async (sql: WorkerSqlClient): Promise<void> => {
    await sql`select 1`;
};

export const createProductionWorker = async (
    environment: WorkerEnvironment,
): Promise<ProductionWorkerRuntime> => {
    const contract = queueContracts.find(({ name }) => name === "default");

    if (contract === undefined) {
        throw new Error("The default queue contract is missing.");
    }

    const sql = createWorkerSqlClient(environment);
    const redis = createRedis(environment);

    try {
        await Promise.all([
            assertDatabaseReady(sql),
            redis.connect().then(async () => redis.ping()),
        ]);
    } catch (error) {
        await Promise.allSettled([sql.end(), closeRedis(redis)]);
        throw error;
    }

    const emailQueue = new Queue("default", {
        connection: redis,
        prefix: environment.BULLMQ_PREFIX,
        defaultJobOptions: {
            attempts: contract.defaultMaxAttempts,
            removeOnComplete: { age: 86_400, count: 1_000 },
            removeOnFail: { age: 604_800, count: 5_000 },
        },
    });
    const repository = new PostgresTaskNotificationRepository(sql);
    const worker = createDefaultQueueWorker(
        redis,
        environment.BULLMQ_PREFIX,
        contract.concurrency.minimum,
        {
            taskAssigneesAdded: new TaskAssigneesAddedProcessor(
                repository,
                emailQueue,
                {
                    appUrl: environment.APP_URL,
                    appPanelPath: environment.APP_PANEL_PATH,
                    ...(environment.APP_PANEL_DOMAIN === undefined
                        ? {}
                        : { appPanelDomain: environment.APP_PANEL_DOMAIN }),
                },
            ),
            taskAssigneeEmail: new TaskAssigneeEmailProcessor(
                emailTransport(environment),
            ),
        },
    );
    let closed = false;

    return {
        worker,
        close: async () => {
            if (closed) {
                return;
            }

            closed = true;
            await worker.close(false);
            await emailQueue.close();
            await sql.end();
            await closeRedis(redis);
        },
    };
};
