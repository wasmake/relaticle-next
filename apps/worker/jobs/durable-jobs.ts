import type { Job } from "bullmq";

import {
    chatProcessJobSchema,
    chatTitleJobSchema,
    csvJobSchema,
    emailDeliveryJobSchema,
    faviconFetchJobSchema,
    mailcoachRecencySyncJobSchema,
    mailcoachSubscriberSyncJobSchema,
    mailcoachTagsModifyJobSchema,
    type ChatProcessJob,
    type ChatTitleJob,
    type CsvJob,
    type EmailDeliveryJob,
    type FaviconFetchJob,
    type MailcoachRecencySyncJob,
    type MailcoachSubscriberSyncJob,
    type MailcoachTagsModifyJob,
} from "../../../packages/queue/src/jobs.js";
import type { QueueJobProcessor } from "../worker.js";

export interface DurableJobOperations {
    exportCsv(job: CsvJob, signal: AbortSignal): Promise<void>;
    importCsv(job: CsvJob, signal: AbortSignal): Promise<void>;
    processChat(job: ChatProcessJob, signal: AbortSignal): Promise<void>;
    generateChatTitle(job: ChatTitleJob, signal: AbortSignal): Promise<void>;
    fetchFavicon(job: FaviconFetchJob, signal: AbortSignal): Promise<void>;
    sendEmail(job: EmailDeliveryJob, signal: AbortSignal): Promise<void>;
    syncMailcoachSubscriber(job: MailcoachSubscriberSyncJob, signal: AbortSignal): Promise<void>;
    modifyMailcoachTags(job: MailcoachTagsModifyJob, signal: AbortSignal): Promise<void>;
    syncMailcoachRecency(job: MailcoachRecencySyncJob, signal: AbortSignal): Promise<void>;
}

type Operation = (input: unknown, signal: AbortSignal) => Promise<void>;

export class DurableJobProcessor implements QueueJobProcessor {
    public constructor(private readonly operation: Operation) {}

    public process(input: unknown, job: Job, signal = new AbortController().signal): Promise<void> {
        void job;
        return this.operation(input, signal);
    }
}

export const createDurableProcessors = (operations: DurableJobOperations) => ({
    csvExport: new DurableJobProcessor(async (input, signal) => operations.exportCsv(csvJobSchema.parse(input), signal)),
    csvImport: new DurableJobProcessor(async (input, signal) => operations.importCsv(csvJobSchema.parse(input), signal)),
    chatProcess: new DurableJobProcessor(async (input, signal) => operations.processChat(chatProcessJobSchema.parse(input), signal)),
    chatTitle: new DurableJobProcessor(async (input, signal) => operations.generateChatTitle(chatTitleJobSchema.parse(input), signal)),
    favicon: new DurableJobProcessor(async (input, signal) => operations.fetchFavicon(faviconFetchJobSchema.parse(input), signal)),
    email: new DurableJobProcessor(async (input, signal) => operations.sendEmail(emailDeliveryJobSchema.parse(input), signal)),
    mailcoachSubscriber: new DurableJobProcessor(async (input, signal) => operations.syncMailcoachSubscriber(mailcoachSubscriberSyncJobSchema.parse(input), signal)),
    mailcoachTags: new DurableJobProcessor(async (input, signal) => operations.modifyMailcoachTags(mailcoachTagsModifyJobSchema.parse(input), signal)),
    mailcoachRecency: new DurableJobProcessor(async (input, signal) => operations.syncMailcoachRecency(mailcoachRecencySyncJobSchema.parse(input), signal)),
});
