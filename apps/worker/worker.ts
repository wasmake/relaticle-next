import { UnrecoverableError, Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";

import {
    jobContractFor,
    queueJobContracts,
    taskAssigneeEmailJobName,
    taskAssigneesAddedJobName,
} from "../../packages/queue/src/jobs.js";
import type { QueueName, ResolvedQueueContract } from "../../packages/queue/src/queues.js";
import type { TaskAssigneeEmailProcessor } from "./jobs/task-assignee-email.js";
import type { TaskAssigneesAddedProcessor } from "./jobs/task-assignees-added.js";

export interface QueueJobProcessor {
    process(input: unknown, job: Job, signal?: AbortSignal): Promise<unknown>;
}

export type QueueProcessors = Readonly<Record<string, QueueJobProcessor>>;
export type WorkerHealthSignal = Readonly<{
    queue: QueueName;
    state: "ready" | "active" | "completed" | "failed" | "stalled" | "error" | "closed";
    at: string;
    jobId?: string;
    jobName?: string;
    detail?: string;
}>;

export type HealthSignalWriter = (signal: WorkerHealthSignal) => Promise<void>;

const processorFor = (queue: QueueName, processors: QueueProcessors, job: Job): QueueJobProcessor => {
    const contract = jobContractFor(job.name);
    if (contract === undefined || contract.queue !== queue) {
        throw new UnrecoverableError(`Unknown ${queue} queue job: ${job.name}`);
    }
    const processor = processors[job.name];
    if (processor === undefined) {
        throw new UnrecoverableError(`No processor registered for ${job.name}`);
    }
    contract.schema.parse(job.data);
    return processor;
};

const report = (writer: HealthSignalWriter | undefined, signal: WorkerHealthSignal): void => {
    if (writer !== undefined) {
        void writer(signal).catch((error: unknown) => {
            console.error("BullMQ health signal failed", {
                queue: signal.queue,
                error: error instanceof Error ? error.message : "Unknown error",
            });
        });
    }
};

export const createQueueWorker = (
    connection: Redis,
    prefix: string,
    contract: ResolvedQueueContract,
    processors: QueueProcessors,
    health?: HealthSignalWriter,
): Worker => {
    const worker = new Worker(
        contract.name,
        async (job: Job): Promise<unknown> => {
            report(health, {
                queue: contract.name, state: "active", at: new Date().toISOString(),
                ...(job.id === undefined ? {} : { jobId: job.id }), jobName: job.name,
            });
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(new Error(`${job.name} exceeded its ${contract.workerTimeoutMilliseconds}ms timeout.`)), contract.workerTimeoutMilliseconds);
            try {
                return await Promise.race([
                    processorFor(contract.name, processors, job).process(job.data, job, controller.signal),
                    new Promise<never>((_resolve, reject) => controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true })),
                ]);
            } finally {
                clearTimeout(timeout);
            }
        },
        {
            connection, prefix, concurrency: contract.concurrency.maximum, autorun: false,
            lockDuration: contract.workerTimeoutMilliseconds,
        },
    );

    worker.on("ready", () => report(health, { queue: contract.name, state: "ready", at: new Date().toISOString() }));
    worker.on("completed", (job: Job) => {
        console.info("BullMQ job completed", { queue: contract.name, jobId: job.id, name: job.name });
        report(health, { queue: contract.name, state: "completed", at: new Date().toISOString(), ...(job.id === undefined ? {} : { jobId: job.id }), jobName: job.name });
    });
    worker.on("failed", (job: Job | undefined, error: Error) => {
        console.error("BullMQ job failed", { queue: contract.name, jobId: job?.id, name: job?.name, error: error.message });
        report(health, { queue: contract.name, state: "failed", at: new Date().toISOString(), ...(job?.id === undefined ? {} : { jobId: job.id }), ...(job === undefined ? {} : { jobName: job.name }), detail: error.message });
    });
    worker.on("error", (error: Error) => {
        console.error("BullMQ worker error", { queue: contract.name, error: error.message });
        report(health, { queue: contract.name, state: "error", at: new Date().toISOString(), detail: error.message });
    });
    worker.on("stalled", (jobId: string) => {
        console.error("BullMQ job stalled", { queue: contract.name, jobId });
        report(health, { queue: contract.name, state: "stalled", at: new Date().toISOString(), jobId });
    });
    worker.on("closed", () => report(health, { queue: contract.name, state: "closed", at: new Date().toISOString() }));

    return worker;
};

export const assertCompleteProcessorRegistry = (processors: QueueProcessors): void => {
    const missing = queueJobContracts.filter(({ name }) => processors[name] === undefined).map(({ name }) => name);
    if (missing.length > 0) throw new Error(`Missing BullMQ processors: ${missing.join(", ")}.`);
};

export type DefaultQueueProcessors = Readonly<{
    taskAssigneesAdded: TaskAssigneesAddedProcessor;
    taskAssigneeEmail: TaskAssigneeEmailProcessor;
}>;

export const createDefaultQueueWorker = (
    connection: Redis,
    prefix: string,
    concurrency: number,
    processors: DefaultQueueProcessors,
): Worker => createQueueWorker(connection, prefix, {
    name: "default", workerTimeoutMilliseconds: 60_000, defaultMaxAttempts: 1,
    waitThresholdMilliseconds: 60_000, concurrency: { minimum: concurrency, maximum: concurrency },
}, {
    [taskAssigneesAddedJobName]: { process: (input) => processors.taskAssigneesAdded.process(input) },
    [taskAssigneeEmailJobName]: { process: (input) => processors.taskAssigneeEmail.process(input) },
});
