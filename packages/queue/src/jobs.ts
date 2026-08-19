import { createHash } from "node:crypto";

import { z } from "zod";

import type { QueueName } from "./queues.js";

const ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/u);
const nonEmpty = z.string().trim().min(1);
const nullableString = z.string().nullable();

export const taskAssigneesAddedJobName = "task.assignees.added" as const;
export const taskAssigneeEmailJobName = "task.assignee.email" as const;
export const csvExportJobName = "csv.export" as const;
export const csvImportJobName = "csv.import" as const;
export const chatProcessJobName = "chat.message.process" as const;
export const chatTitleJobName = "chat.title.generate" as const;
export const faviconFetchJobName = "company.favicon.fetch" as const;
export const accountPasswordResetEmailJobName = "account.password-reset.email" as const;
export const accountVerificationEmailJobName = "account.verification.email" as const;
export const accountDeletionScheduledEmailJobName = "account.deletion.scheduled.email" as const;
export const accountDeletionCancelledEmailJobName = "account.deletion.cancelled.email" as const;
export const accountDeletionReminderEmailJobName = "account.deletion.reminder.email" as const;
export const teamInvitationEmailJobName = "team.invitation.email" as const;
export const teamDeletionScheduledEmailJobName = "team.deletion.scheduled.email" as const;
export const teamDeletionCancelledEmailJobName = "team.deletion.cancelled.email" as const;
export const teamDeletionReminderEmailJobName = "team.deletion.reminder.email" as const;
export const teamMemberRemovedEmailJobName = "team.member.removed.email" as const;
export const teamMemberJoinedEmailJobName = "team.member.joined.email" as const;
export const teamMemberRoleChangedEmailJobName = "team.member.role-changed.email" as const;
export const taskDigestEmailJobName = "task.digest.email" as const;
export const trialEndingEmailJobName = "trial.ending.email" as const;
export const contactSubmissionEmailJobName = "contact.submission.email" as const;
export const mailcoachSubscriberSyncJobName = "mailcoach.subscriber.sync" as const;
export const mailcoachTagsModifyJobName = "mailcoach.tags.modify" as const;
export const mailcoachRecencySyncJobName = "mailcoach.recency.sync" as const;

export const accountAndTeamEmailJobNames = [
    accountPasswordResetEmailJobName,
    accountVerificationEmailJobName,
    accountDeletionScheduledEmailJobName,
    accountDeletionCancelledEmailJobName,
    accountDeletionReminderEmailJobName,
    teamInvitationEmailJobName,
    teamDeletionScheduledEmailJobName,
    teamDeletionCancelledEmailJobName,
    teamDeletionReminderEmailJobName,
    teamMemberRemovedEmailJobName,
    teamMemberJoinedEmailJobName,
    teamMemberRoleChangedEmailJobName,
] as const;

export const genericEmailJobNames = [
    ...accountAndTeamEmailJobNames,
    taskDigestEmailJobName,
    trialEndingEmailJobName,
    contactSubmissionEmailJobName,
] as const;

export const taskAssigneesAddedJobSchema = z.object({
    version: z.literal(1),
    eventId: z.uuid(),
    teamId: ulid,
    taskId: ulid,
    taskTitle: z.string(),
    recipients: z.array(z.object({ userId: ulid, databaseNotificationId: z.uuid() })).min(1),
});

export const taskAssigneeEmailJobSchema = z.object({
    version: z.literal(1), eventId: z.uuid(), recipientId: ulid,
    recipientName: z.string(), recipientEmail: z.email(), taskTitle: z.string(), taskUrl: z.url(),
});

const csvContextSchema = z.object({
    requestId: nonEmpty, teamId: ulid, userId: ulid,
    abilities: z.array(z.enum(["read", "create", "update", "delete"])),
});

export const csvJobSchema = z.object({
    version: z.literal(1), jobId: ulid, resource: z.enum(["companies", "people", "opportunities", "tasks", "notes"]),
    context: csvContextSchema,
});

export const chatProcessJobSchema = z.object({
    version: z.literal(1), turnId: z.uuid(), teamId: ulid, userId: ulid,
    conversationId: nonEmpty, message: nonEmpty.max(5_000), model: nonEmpty.optional(),
    document: z.unknown().optional(),
    mentions: z.array(z.object({ type: nonEmpty, id: nonEmpty })).max(20).default([]),
    pageContext: z.object({ type: nonEmpty, id: nonEmpty }).nullable().default(null),
});

export const chatTitleJobSchema = z.object({
    version: z.literal(1), conversationId: nonEmpty, provisionalTitle: nonEmpty.max(80),
    message: nonEmpty.max(5_000), provider: nullableString.default(null),
});

export const faviconFetchJobSchema = z.object({
    version: z.literal(1), companyId: ulid, teamId: ulid, domain: nonEmpty.max(2_048),
});

export const emailDeliveryJobSchema = z.object({
    version: z.literal(1), deliveryId: nonEmpty.max(200), to: z.email(),
    subject: nonEmpty.max(998), html: nonEmpty, text: z.string().optional(),
    replyTo: z.email().optional(),
});

export const mailcoachSubscriberSyncJobSchema = z.object({
    version: z.literal(1), email: z.email(), userId: ulid.nullable(),
    firstName: z.string().optional(), lastName: z.string().optional(),
    tags: z.array(nonEmpty).default([]), attributes: z.record(z.string(), z.unknown()).default({}),
});

export const mailcoachTagsModifyJobSchema = z.object({
    version: z.literal(1), subscriberUuid: nonEmpty, tags: z.array(nonEmpty).min(1),
    action: z.enum(["add", "remove"]).default("add"),
});

export const mailcoachRecencySyncJobSchema = z.object({
    version: z.literal(1), userId: ulid, subscriberUuid: nonEmpty,
    oldBucket: nullableString, newBucket: nullableString,
});

export type TaskAssigneesAddedJob = z.infer<typeof taskAssigneesAddedJobSchema>;
export type TaskAssigneeEmailJob = z.infer<typeof taskAssigneeEmailJobSchema>;
export type CsvJob = z.infer<typeof csvJobSchema>;
export type ChatProcessJob = z.infer<typeof chatProcessJobSchema>;
export type ChatTitleJob = z.infer<typeof chatTitleJobSchema>;
export type FaviconFetchJob = z.infer<typeof faviconFetchJobSchema>;
export type EmailDeliveryJob = z.infer<typeof emailDeliveryJobSchema>;
export type MailcoachSubscriberSyncJob = z.infer<typeof mailcoachSubscriberSyncJobSchema>;
export type MailcoachTagsModifyJob = z.infer<typeof mailcoachTagsModifyJobSchema>;
export type MailcoachRecencySyncJob = z.infer<typeof mailcoachRecencySyncJobSchema>;

export type QueueJobContract = Readonly<{
    name: string;
    queue: QueueName;
    schema: z.ZodType;
    attempts: number;
    backoffMilliseconds: number;
}>;

const contract = (name: string, queue: QueueName, schema: z.ZodType, attempts: number, backoffMilliseconds: number): QueueJobContract =>
    ({ name, queue, schema, attempts, backoffMilliseconds });

export const queueJobContracts = [
    contract(taskAssigneesAddedJobName, "default", taskAssigneesAddedJobSchema, 3, 1_000),
    contract(taskAssigneeEmailJobName, "default", taskAssigneeEmailJobSchema, 5, 2_000),
    contract(csvExportJobName, "imports", csvJobSchema, 2, 5_000),
    contract(csvImportJobName, "imports", csvJobSchema, 2, 5_000),
    contract(chatProcessJobName, "chat", chatProcessJobSchema, 5, 2_000),
    ...genericEmailJobNames.map((name) => contract(name, "default", emailDeliveryJobSchema, 5, 2_000)),
    contract(mailcoachSubscriberSyncJobName, "default", mailcoachSubscriberSyncJobSchema, 5, 1_000),
    contract(mailcoachTagsModifyJobName, "default", mailcoachTagsModifyJobSchema, 5, 1_000),
    contract(mailcoachRecencySyncJobName, "default", mailcoachRecencySyncJobSchema, 5, 1_000),
] as const satisfies readonly QueueJobContract[];

export const handledJobNames = queueJobContracts.map(({ name }) => name);

export const jobContractFor = (name: string): QueueJobContract | undefined =>
    queueJobContracts.find((candidate) => candidate.name === name);

const safeIdPart = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/gu, "-").slice(0, 80);

export const durableJobId = (name: string, identity: string): string => {
    const digest = createHash("sha256").update(identity).digest("hex").slice(0, 24);
    return `${safeIdPart(name)}-${safeIdPart(identity)}-${digest}`.slice(0, 160);
};

export const jobOptionsFor = (name: string, identity: string) => {
    const job = jobContractFor(name);
    if (job === undefined) throw new Error(`Unknown queue job: ${name}.`);
    return {
        jobId: durableJobId(name, identity), attempts: job.attempts,
        backoff: { type: "exponential" as const, delay: job.backoffMilliseconds },
        removeOnComplete: { age: 86_400, count: 1_000 },
        removeOnFail: { age: 604_800, count: 5_000 },
    };
};
