import { isIP } from "node:net";

import { Resend } from "resend";

import type {
    ChatProcessJob,
    ChatTitleJob,
    CsvJob,
    EmailDeliveryJob,
    FaviconFetchJob,
    MailcoachRecencySyncJob,
    MailcoachSubscriberSyncJob,
    MailcoachTagsModifyJob,
} from "../../../packages/queue/src/jobs.js";
import type { WorkerSqlClient } from "../database.js";
import type { WorkerEnvironment } from "../environment.js";
import type { DurableJobOperations } from "./durable-jobs.js";

export type ApplicationJobOperations = Pick<
    DurableJobOperations,
    "exportCsv" | "importCsv" | "processChat" | "generateChatTitle" | "fetchFavicon"
>;

const safeMailcoachEndpoint = (environment: WorkerEnvironment, path: string): URL => {
    if (environment.MAILCOACH_API_ENDPOINT === undefined) {
        throw new Error("MAILCOACH_API_ENDPOINT is required for Mailcoach jobs.");
    }
    return new URL(path.replace(/^\/+/, ""), `${environment.MAILCOACH_API_ENDPOINT.replace(/\/+$/u, "")}/`);
};

export class ProductionOutboundOperations implements DurableJobOperations {
    private readonly resend: Resend | undefined;

    public constructor(
        private readonly sql: WorkerSqlClient,
        private readonly environment: WorkerEnvironment,
        private readonly application: ApplicationJobOperations,
    ) {
        this.resend = environment.MAIL_MAILER === "resend" && environment.RESEND_KEY !== undefined
            ? new Resend(environment.RESEND_KEY)
            : undefined;
    }

    public exportCsv(job: CsvJob, signal: AbortSignal): Promise<void> { return this.application.exportCsv(job, signal); }
    public importCsv(job: CsvJob, signal: AbortSignal): Promise<void> { return this.application.importCsv(job, signal); }
    public processChat(job: ChatProcessJob, signal: AbortSignal): Promise<void> { return this.application.processChat(job, signal); }
    public generateChatTitle(job: ChatTitleJob, signal: AbortSignal): Promise<void> { return this.application.generateChatTitle(job, signal); }
    public fetchFavicon(job: FaviconFetchJob, signal: AbortSignal): Promise<void> { return this.application.fetchFavicon(job, signal); }

    public async sendEmail(job: EmailDeliveryJob): Promise<void> {
        if (this.resend === undefined) {
            console.info("BullMQ email logged", { deliveryId: job.deliveryId, to: job.to, subject: job.subject });
            return;
        }
        const response = await this.resend.emails.send({
            from: `${this.environment.MAIL_FROM_NAME} <${this.environment.MAIL_FROM_ADDRESS}>`,
            to: job.to, subject: job.subject, html: job.html,
            ...(job.text === undefined ? {} : { text: job.text }),
            ...(job.replyTo === undefined ? {} : { replyTo: job.replyTo }),
        }, { idempotencyKey: job.deliveryId });
        if (response.error !== null) throw new Error(`Resend rejected email: ${response.error.message}`);
    }

    public async syncMailcoachSubscriber(job: MailcoachSubscriberSyncJob, signal: AbortSignal): Promise<void> {
        const response = await this.mailcoach("subscribers/sync", "POST", {
            email: job.email, first_name: job.firstName, last_name: job.lastName,
            tags: job.tags, ...job.attributes,
        }, signal);
        const value = await response.json() as unknown;
        const record = typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
        const data = typeof record?.data === "object" && record.data !== null ? record.data as Record<string, unknown> : undefined;
        const uuid = typeof data?.uuid === "string" ? data.uuid : typeof record?.uuid === "string" ? record.uuid : undefined;
        if (job.userId !== null && uuid !== undefined) {
            await this.sql`update users set mailcoach_subscriber_uuid = ${uuid}, updated_at = now() where id = ${job.userId} and mailcoach_subscriber_uuid is null`;
        }
    }

    public async modifyMailcoachTags(job: MailcoachTagsModifyJob, signal: AbortSignal): Promise<void> {
        await this.mailcoach(`subscribers/${encodeURIComponent(job.subscriberUuid)}/tags`, job.action === "add" ? "POST" : "DELETE", { tags: job.tags }, signal);
    }

    public async syncMailcoachRecency(job: MailcoachRecencySyncJob, signal: AbortSignal): Promise<void> {
        if (job.oldBucket !== null) await this.modifyMailcoachTags({ version: 1, subscriberUuid: job.subscriberUuid, tags: [job.oldBucket], action: "remove" }, signal);
        if (job.newBucket !== null) await this.modifyMailcoachTags({ version: 1, subscriberUuid: job.subscriberUuid, tags: [job.newBucket], action: "add" }, signal);
        await this.sql`update users set subscriber_recency_bucket = ${job.newBucket}, updated_at = now() where id = ${job.userId}`;
    }

    private async mailcoach(path: string, method: "DELETE" | "POST", body: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<Response> {
        if (this.environment.MAILCOACH_API_TOKEN === undefined) throw new Error("MAILCOACH_API_TOKEN is required for Mailcoach jobs.");
        const endpoint = safeMailcoachEndpoint(this.environment, path);
        if (endpoint.hostname === "localhost" || isIP(endpoint.hostname) !== 0) throw new Error("Mailcoach endpoint must use a public hostname.");
        const response = await fetch(endpoint, {
            method, signal, headers: { authorization: `Bearer ${this.environment.MAILCOACH_API_TOKEN}`, accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(`Mailcoach returned HTTP ${response.status}.`);
        return response;
    }
}
