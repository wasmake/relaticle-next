import { Queue } from "bullmq";
import Redis from "ioredis";

import { queueContracts, type QueueName } from "@queue/queues";
import { getEnvironment } from "@/server/env";

const queues = new Map<string, Queue>();
let queueConnection: Redis | undefined;

const getQueueConnection = (): Redis => {
    if (queueConnection !== undefined) {
        return queueConnection;
    }

    const environment = getEnvironment();
    queueConnection = environment.REDIS_URL
        ? new Redis(environment.REDIS_URL, {
              maxRetriesPerRequest: null,
              enableReadyCheck: true,
          })
        : new Redis({
              host: environment.REDIS_HOST,
              port: environment.REDIS_PORT,
              username: environment.REDIS_USERNAME,
              password: environment.REDIS_PASSWORD,
              db: environment.REDIS_DB,
              maxRetriesPerRequest: null,
              enableReadyCheck: true,
          });

    return queueConnection;
};

export const getQueue = (name: QueueName): Queue => {
    const existing = queues.get(name);

    if (existing !== undefined) {
        return existing;
    }

    const contract = queueContracts.find((candidate) => candidate.name === name);

    if (contract === undefined) {
        throw new Error(`Missing queue contract for ${name}.`);
    }

    const queue = new Queue(name, {
        connection: getQueueConnection(),
        prefix: getEnvironment().BULLMQ_PREFIX,
        defaultJobOptions: {
            attempts: contract.defaultMaxAttempts,
            backoff: { type: "exponential", delay: 1_000 },
            removeOnComplete: { age: 86_400, count: 1_000 },
            removeOnFail: { age: 604_800, count: 5_000 },
        },
    });
    queues.set(name, queue);

    return queue;
};

export const closeQueues = async (): Promise<void> => {
    await Promise.all([...queues.values()].map((queue) => queue.close()));
    queues.clear();

    if (queueConnection !== undefined) {
        await queueConnection.quit();
        queueConnection = undefined;
    }
};
