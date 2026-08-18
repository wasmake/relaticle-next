import { Resend } from "resend";

import {
    taskAssigneeEmailJobSchema,
    type TaskAssigneeEmailJob,
} from "../../../packages/queue/src/jobs.js";
import { renderTaskAssignedMail } from "../mail/task-assigned.js";

export type TaskAssignmentEmailMessage = Readonly<{
    eventId: string;
    recipientId: string;
    recipientName: string;
    recipientEmail: string;
    subject: string;
    html: string;
    text: string;
}>;

export interface TaskAssignmentEmailTransport {
    send(message: TaskAssignmentEmailMessage): Promise<void>;
}

export class ResendTaskAssignmentEmailTransport implements TaskAssignmentEmailTransport {
    private readonly resend: Resend;

    public constructor(
        apiKey: string,
        private readonly fromAddress: string,
        private readonly fromName: string,
    ) {
        this.resend = new Resend(apiKey);
    }

    public async send(message: TaskAssignmentEmailMessage): Promise<void> {
        const recipientName = message.recipientName
            .replace(/[\r\n]+/gu, " ")
            .replace(/["\\]/gu, "");
        const idempotencyKey = `task-assignee-${message.eventId}-${message.recipientId}`;
        const result = await this.resend.emails.send(
            {
                from: `${this.fromName} <${this.fromAddress}>`,
                to: [`"${recipientName}" <${message.recipientEmail}>`],
                subject: message.subject,
                html: message.html,
                text: message.text,
                headers: {
                    "X-Entity-Ref-ID": idempotencyKey,
                },
            },
            { idempotencyKey },
        );

        if (result.error !== null) {
            throw new Error(`Resend rejected task assignment email: ${result.error.message}`);
        }
    }
}

export class LogTaskAssignmentEmailTransport implements TaskAssignmentEmailTransport {
    public async send(message: TaskAssignmentEmailMessage): Promise<void> {
        console.info("Task assignment email logged", {
            eventId: message.eventId,
            recipientId: message.recipientId,
        });
    }
}

export class TaskAssigneeEmailProcessor {
    public constructor(private readonly transport: TaskAssignmentEmailTransport) {}

    public async process(input: unknown): Promise<void> {
        const job: TaskAssigneeEmailJob = taskAssigneeEmailJobSchema.parse(input);
        const rendered = renderTaskAssignedMail(job);

        await this.transport.send({
            eventId: job.eventId,
            recipientId: job.recipientId,
            recipientName: job.recipientName,
            recipientEmail: job.recipientEmail,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
        });
    }
}
