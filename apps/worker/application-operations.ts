import type {
    ChatProcessJob,
    ChatTitleJob,
    CsvJob,
    FaviconFetchJob,
} from "../../packages/queue/src/jobs.js";
import type { ApplicationJobOperations } from "./jobs/outbound-operations.js";

export type WorkerRequestContext = Readonly<{
    requestId: string;
    teamId: string;
    userId: string;
    credential: Readonly<{
        kind: "personal_access_token";
        tokenId: string;
        abilities: readonly ("read" | "create" | "update" | "delete")[];
    }>;
}>;

export interface CsvExecutionService {
    processExport(context: WorkerRequestContext, id: string): Promise<void>;
    processImport(context: WorkerRequestContext, id: string): Promise<void>;
}

export interface ChatExecutionService {
    send(
        identity: Readonly<{ teamId: string; userId: string }>,
        input: Readonly<{
            conversationId: string;
            message: string;
            document?: unknown;
            model?: string;
            mentions: readonly Readonly<{ type: string; id: string }>[];
            pageContext: Readonly<{ type: string; id: string }> | null;
        }>,
    ): AsyncIterable<Readonly<{ type: string; message?: unknown }>>;
    cancel(identity: Readonly<{ teamId: string; userId: string }>, conversationId: string): Promise<boolean>;
}

export interface ConversationTitleService {
    generate(message: string, signal: AbortSignal): Promise<string | undefined>;
}

export interface ConversationTitleStore {
    replaceProvisional(conversationId: string, provisionalTitle: string, title: string): Promise<boolean>;
}

export type FaviconFile = Readonly<{ bytes: Uint8Array; mimeType: string; fileName: string }>;

export interface FaviconImageFetcher {
    fetch(url: string, signal: AbortSignal): Promise<FaviconFile>;
}

export interface CompanyLogoService {
    replace(
        context: Readonly<{ requestId: string; teamId: string; userId: string }>,
        companyId: string,
        file: FaviconFile,
    ): Promise<void>;
}

const contextFor = (job: CsvJob): WorkerRequestContext => ({
    requestId: job.context.requestId,
    teamId: job.context.teamId,
    userId: job.context.userId,
    credential: {
        kind: "personal_access_token",
        tokenId: job.jobId,
        abilities: job.context.abilities,
    },
});

const cleanTitle = (value: string): string =>
    value.replace(/[\r\n\t]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 80);

const faviconUrl = (domain: string): string => {
    const website = new URL(/^https?:\/\//u.test(domain) ? domain : `https://${domain}`);
    return new URL("/favicon.ico", website).toString();
};

export class ConcreteApplicationJobOperations implements ApplicationJobOperations {
    public constructor(
        private readonly csv: CsvExecutionService,
        private readonly chat: ChatExecutionService,
        private readonly titles: ConversationTitleService,
        private readonly titleStore: ConversationTitleStore,
        private readonly favicons: FaviconImageFetcher,
        private readonly logos: CompanyLogoService,
    ) {}

    public exportCsv(job: CsvJob): Promise<void> {
        return this.csv.processExport(contextFor(job), job.jobId);
    }

    public importCsv(job: CsvJob): Promise<void> {
        return this.csv.processImport(contextFor(job), job.jobId);
    }

    public async processChat(job: ChatProcessJob, signal: AbortSignal): Promise<void> {
        const identity = { teamId: job.teamId, userId: job.userId };
        const cancel = (): void => { void this.chat.cancel(identity, job.conversationId); };
        signal.addEventListener("abort", cancel, { once: true });
        try {
            const input = {
                conversationId: job.conversationId,
                message: job.message,
                mentions: job.mentions,
                pageContext: job.pageContext,
                ...(job.document === undefined ? {} : { document: job.document }),
                ...(job.model === undefined ? {} : { model: job.model }),
            };
            for await (const event of this.chat.send(identity, input)) {
                if (event.type === "error") throw new Error(typeof event.message === "string" ? event.message : "Chat processing failed.");
            }
        } finally {
            signal.removeEventListener("abort", cancel);
        }
    }

    public async generateChatTitle(job: ChatTitleJob, signal: AbortSignal): Promise<void> {
        const generated = await this.titles.generate(job.message, signal);
        if (generated === undefined) return;
        const title = cleanTitle(generated);
        if (title !== "") await this.titleStore.replaceProvisional(job.conversationId, job.provisionalTitle, title);
    }

    public async fetchFavicon(job: FaviconFetchJob, signal: AbortSignal): Promise<void> {
        const file = await this.favicons.fetch(faviconUrl(job.domain), signal);
        await this.logos.replace({ requestId: `favicon:${job.companyId}`, teamId: job.teamId, userId: job.teamId }, job.companyId, file);
    }
}
