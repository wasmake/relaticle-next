import { UnrecoverableError, Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";

import {
    taskAssigneeEmailJobName,
    taskAssigneesAddedJobName,
} from "../../packages/queue/src/jobs.js";
import type { TaskAssigneeEmailProcessor } from "./jobs/task-assignee-email.js";
import type { TaskAssigneesAddedProcessor } from "./jobs/task-assignees-added.js";

export type DefaultQueueProcessors = Readonly<{
    taskAssigneesAdded: TaskAssigneesAddedProcessor;
    taskAssigneeEmail: TaskAssigneeEmailProcessor;
}>;

export const createDefaultQueueWorker = (
    connection: Redis,
    prefix: string,
    concurrency: number,
    processors: DefaultQueueProcessors,
): Worker => {
    const worker = new Worker(
        "default",
        async (job: Job): Promise<void> => {
            if (job.name === taskAssigneesAddedJobName) {
                await processors.taskAssigneesAdded.process(job.data);

                return;
            }

            if (job.name === taskAssigneeEmailJobName) {
                await processors.taskAssigneeEmail.process(job.data);

                return;
            }

            throw new UnrecoverableError(`Unknown default queue job: ${job.name}`);
        },
        {
            connection,
            prefix,
            concurrency,
            autorun: false,
        },
    );

    worker.on("completed", (job: Job) => {
        console.info("BullMQ job completed", { jobId: job.id, name: job.name });
    });
    worker.on("failed", (job: Job | undefined, error: Error) => {
        console.error("BullMQ job failed", {
            jobId: job?.id,
            name: job?.name,
            error: error.message,
        });
    });
    worker.on("error", (error: Error) => {
        console.error("BullMQ worker error", { error: error.message });
    });

    return worker;
};
