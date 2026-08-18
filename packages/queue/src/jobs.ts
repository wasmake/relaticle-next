import { z } from "zod";

const ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/u);

export const taskAssigneesAddedJobName = "task.assignees.added" as const;
export const taskAssigneeEmailJobName = "task.assignee.email" as const;

export const taskAssigneesAddedJobSchema = z.object({
    version: z.literal(1),
    eventId: z.uuid(),
    teamId: ulid,
    taskId: ulid,
    taskTitle: z.string(),
    recipients: z
        .array(
            z.object({
                userId: ulid,
                databaseNotificationId: z.uuid(),
            }),
        )
        .min(1),
});

export const taskAssigneeEmailJobSchema = z.object({
    version: z.literal(1),
    eventId: z.uuid(),
    recipientId: ulid,
    recipientName: z.string(),
    recipientEmail: z.email(),
    taskTitle: z.string(),
    taskUrl: z.string(),
});

export type TaskAssigneesAddedJob = z.infer<
    typeof taskAssigneesAddedJobSchema
>;
export type TaskAssigneeEmailJob = z.infer<typeof taskAssigneeEmailJobSchema>;
