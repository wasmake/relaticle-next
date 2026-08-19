import { randomUUID } from "node:crypto";

import {
    jobOptionsFor,
    taskAssigneesAddedJobName,
    type TaskAssigneesAddedJob,
} from "@queue/jobs";
import type { Ulid } from "@/server/ids";
import { getQueue } from "@/server/queue/client";

export type NewTaskAssigneesNotification = Readonly<{
    teamId: Ulid;
    taskId: Ulid;
    taskTitle: string;
    recipientIds: readonly Ulid[];
}>;

export interface TaskAssigneeNotificationPort {
    dispatchAfterCommit(
        notification: NewTaskAssigneesNotification,
    ): Promise<void>;
}

export interface TaskNotificationQueue {
    add(
        name: typeof taskAssigneesAddedJobName,
        notification: TaskAssigneesAddedJob,
        options: ReturnType<typeof jobOptionsFor>,
    ): Promise<unknown>;
}

export type ScheduleAfterResponse = (callback: () => Promise<void>) => void;

export class BullMqTaskAssigneeNotificationPort implements TaskAssigneeNotificationPort {
    public constructor(
        private readonly queue: TaskNotificationQueue | undefined = undefined,
        private readonly schedule: ScheduleAfterResponse = (callback) => { void callback(); },
        private readonly createUuid: () => string = randomUUID,
    ) {}

    public async dispatchAfterCommit(
        notification: NewTaskAssigneesNotification,
    ): Promise<void> {
        const eventId = this.createUuid();
        const job: TaskAssigneesAddedJob = {
            version: 1,
            eventId,
            teamId: notification.teamId,
            taskId: notification.taskId,
            taskTitle: notification.taskTitle,
            recipients: [...new Set(notification.recipientIds)].map((userId) => ({
                userId,
                databaseNotificationId: this.createUuid(),
            })),
        };

        this.schedule(async () => {
            await (this.queue ?? getQueue("default")).add(
                taskAssigneesAddedJobName,
                job,
                jobOptionsFor(taskAssigneesAddedJobName, eventId),
            );
        });
    }
}
