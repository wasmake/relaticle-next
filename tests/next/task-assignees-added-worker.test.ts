import { describe, expect, it } from "vitest";

import {
    TaskAssigneeEmailProcessor,
    type TaskAssignmentEmailMessage,
    type TaskAssignmentEmailTransport,
} from "../../apps/worker/jobs/task-assignee-email";
import {
    TaskAssigneesAddedProcessor,
    type DatabaseNotificationRow,
    type TaskNotificationEmailQueue,
    type TaskNotificationRecipient,
    type TaskNotificationRepository,
} from "../../apps/worker/jobs/task-assignees-added";
import { renderTaskAssignedMail } from "../../apps/worker/mail/task-assigned";

const teamId = "01J00000000000000000000001";
const taskId = "01J00000000000000000000002";
const recipientId = "01J00000000000000000000003";
const eventId = "11111111-1111-4111-8111-111111111111";
const notificationId = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-08-18T12:00:00.000Z");

const job = {
    version: 1,
    eventId,
    teamId,
    taskId,
    taskTitle: "Follow up",
    recipients: [{ userId: recipientId, databaseNotificationId: notificationId }],
} as const;

class InMemoryNotificationRepository implements TaskNotificationRepository {
    public readonly inserted: DatabaseNotificationRow[] = [];
    public teamSlug: string | undefined = "analytical-engines";

    public constructor(
        public recipients: readonly TaskNotificationRecipient[] = [
            {
                id: recipientId,
                name: "Ada Lovelace",
                email: "ada@example.test",
                notificationPreferences: null,
            },
        ],
    ) {}

    public async findTeamSlug(): Promise<string | undefined> {
        return this.teamSlug;
    }

    public async findRecipients(): Promise<
        readonly TaskNotificationRecipient[]
    > {
        return this.recipients;
    }

    public async insertDatabaseNotifications(
        rows: readonly DatabaseNotificationRow[],
    ): Promise<void> {
        this.inserted.push(...rows);
    }
}

class RecordingEmailQueue implements TaskNotificationEmailQueue {
    public readonly jobs: unknown[] = [];

    public async add(
        name: "task.assignee.email",
        data: Parameters<TaskNotificationEmailQueue["add"]>[1],
        options: Parameters<TaskNotificationEmailQueue["add"]>[2],
    ): Promise<void> {
        this.jobs.push({ name, data, options });
    }
}

describe("task assignee BullMQ processor", () => {
    it("creates the default-on database notification and leaves email off", async () => {
        const repository = new InMemoryNotificationRepository();
        const emailQueue = new RecordingEmailQueue();
        const processor = new TaskAssigneesAddedProcessor(
            repository,
            emailQueue,
            {
                appUrl: "https://crm.example.test",
                appPanelPath: "app",
            },
            () => now,
        );

        await processor.process(job);

        expect(emailQueue.jobs).toEqual([]);
        expect(repository.inserted).toEqual([
            {
                id: notificationId,
                type: "task_assigned",
                notifiableType: "user",
                notifiableId: recipientId,
                data: expect.objectContaining({
                    title: "New Task Assignment: Follow up",
                    icon: "check-circle",
                    format: "relaticle-next",
                    viewData: { task_id: taskId },
                    actions: [
                        expect.objectContaining({
                            name: "view",
                            label: "View Task",
                            markAsRead: true,
                            url: `https://crm.example.test/app/analytical-engines/tasks?tableAction=edit&tableActionRecord=${taskId}`,
                        }),
                    ],
                }),
                readAt: null,
                createdAt: now,
                updatedAt: now,
            },
        ]);
    });

    it("honors channel overrides and queues one stable email job", async () => {
        const repository = new InMemoryNotificationRepository([
            {
                id: recipientId,
                name: "Ada Lovelace",
                email: "ada@example.test",
                notificationPreferences: {
                    task_assigned: { in_app: false, email: true },
                },
            },
        ]);
        const emailQueue = new RecordingEmailQueue();
        const processor = new TaskAssigneesAddedProcessor(
            repository,
            emailQueue,
            {
                appUrl: "http://localhost:8080",
                appPanelDomain: "app.localhost",
                appPanelPath: "ignored",
            },
            () => now,
        );

        await processor.process(job);

        expect(repository.inserted).toEqual([]);
        expect(emailQueue.jobs).toEqual([
            {
                name: "task.assignee.email",
                data: {
                    version: 1,
                    eventId,
                    recipientId,
                    recipientName: "Ada Lovelace",
                    recipientEmail: "ada@example.test",
                    taskTitle: "Follow up",
                    taskUrl: `http://app.localhost:8080/analytical-engines/tasks?tableAction=edit&tableActionRecord=${taskId}`,
                },
                options: {
                    jobId: `task-assignee-email-${eventId}-${recipientId}`,
                },
            },
        ]);
    });

    it("skips recipients that no longer belong to the workspace and rejects malformed jobs", async () => {
        const repository = new InMemoryNotificationRepository([]);
        const emailQueue = new RecordingEmailQueue();
        const processor = new TaskAssigneesAddedProcessor(
            repository,
            emailQueue,
            {
                appUrl: "https://crm.example.test",
                appPanelPath: "app",
            },
        );

        await processor.process(job);

        expect(repository.inserted).toEqual([]);
        expect(emailQueue.jobs).toEqual([]);
        await expect(processor.process({ version: 1 })).rejects.toThrow();
    });
});

describe("task assignment email rendering", () => {
    it("preserves Laravel copy and escapes untrusted task content", () => {
        const rendered = renderTaskAssignedMail({
            version: 1,
            eventId,
            recipientId,
            recipientName: "Ada Lovelace",
            recipientEmail: "ada@example.test",
            taskTitle: '<script>alert("x")</script>',
            taskUrl: 'https://crm.example.test/tasks?value="unsafe"&next=1',
        });

        expect(rendered.subject).toBe(
            `You've been assigned a task: <script>alert("x")</script>`,
        );
        expect(rendered.html).toContain("New task assigned to you");
        expect(rendered.html).toContain(
            "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
        );
        expect(rendered.html).toContain(
            "https://crm.example.test/tasks?value=&quot;unsafe&quot;&amp;next=1",
        );
        expect(rendered.html).not.toContain("<script>");
    });

    it("validates the durable email job before invoking its transport", async () => {
        class RecordingTransport implements TaskAssignmentEmailTransport {
            public readonly messages: TaskAssignmentEmailMessage[] = [];

            public async send(message: TaskAssignmentEmailMessage): Promise<void> {
                this.messages.push(message);
            }
        }

        const transport = new RecordingTransport();
        const processor = new TaskAssigneeEmailProcessor(transport);

        await processor.process({
            version: 1,
            eventId,
            recipientId,
            recipientName: "Ada Lovelace",
            recipientEmail: "ada@example.test",
            taskTitle: "Follow up",
            taskUrl: "https://crm.example.test/app/team/tasks",
        });

        expect(transport.messages).toEqual([
            expect.objectContaining({
                eventId,
                recipientId,
                recipientEmail: "ada@example.test",
                subject: "You've been assigned a task: Follow up",
            }),
        ]);
        await expect(
            processor.process({
                version: 1,
                recipientEmail: "not-an-email",
            }),
        ).rejects.toThrow();
        expect(transport.messages).toHaveLength(1);
    });
});
