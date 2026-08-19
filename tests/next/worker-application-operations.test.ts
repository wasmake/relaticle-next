import { describe, expect, it, vi } from "vitest";
import type { CsvJob } from "../../packages/queue/src/jobs";

import {
    ConcreteApplicationJobOperations,
    type ChatExecutionService,
    type CompanyLogoService,
    type ConversationTitleService,
    type ConversationTitleStore,
    type CsvExecutionService,
    type FaviconImageFetcher,
} from "../../apps/worker/application-operations";

const teamId = "01J00000000000000000000001";
const userId = "01J00000000000000000000002";
const recordId = "01J00000000000000000000003";

const dependencies = () => {
    const csv: CsvExecutionService = {
        processExport: vi.fn(async () => undefined),
        processImport: vi.fn(async () => undefined),
    };
    const send = vi.fn(async function* () { yield { type: "done" }; });
    const chat: ChatExecutionService = {
        send,
        cancel: vi.fn(async () => true),
    };
    const titles: ConversationTitleService = { generate: vi.fn(async () => "  Quarterly\nplanning  ") };
    const titleStore: ConversationTitleStore = { replaceProvisional: vi.fn(async () => true) };
    const file = { bytes: new Uint8Array([137, 80, 78, 71]), mimeType: "image/png", fileName: "favicon.png" };
    const favicons: FaviconImageFetcher = { fetch: vi.fn(async () => file) };
    const logos: CompanyLogoService = { replace: vi.fn(async () => undefined) };
    return { csv, chat, titles, titleStore, favicons, logos, file };
};

const csvJob: CsvJob = {
    version: 1 as const,
    jobId: recordId,
    resource: "companies" as const,
    context: { requestId: "request-1", teamId, userId, abilities: ["read", "create"] },
};

describe("concrete worker application operations", () => {
    it("executes CSV export and import through the shared CSV service", async () => {
        const ports = dependencies();
        const operations = new ConcreteApplicationJobOperations(ports.csv, ports.chat, ports.titles, ports.titleStore, ports.favicons, ports.logos);
        await operations.exportCsv(csvJob);
        await operations.importCsv(csvJob);
        const expectedContext = expect.objectContaining({
            requestId: "request-1", teamId, userId,
            credential: expect.objectContaining({ kind: "personal_access_token", tokenId: recordId, abilities: ["read", "create"] }),
        });
        expect(ports.csv.processExport).toHaveBeenCalledWith(expectedContext, recordId);
        expect(ports.csv.processImport).toHaveBeenCalledWith(expectedContext, recordId);
    });

    it("executes and drains chat processing", async () => {
        const ports = dependencies();
        const operations = new ConcreteApplicationJobOperations(ports.csv, ports.chat, ports.titles, ports.titleStore, ports.favicons, ports.logos);
        await operations.processChat({
            version: 1, turnId: "11111111-1111-4111-8111-111111111111", teamId, userId,
            conversationId: "conversation-1", message: "Summarize Acme", model: "gpt",
            mentions: [{ type: "company", id: recordId }], pageContext: null,
        }, new AbortController().signal);
        expect(ports.chat.send).toHaveBeenCalledWith(
            { teamId, userId },
            expect.objectContaining({ conversationId: "conversation-1", message: "Summarize Acme", model: "gpt" }),
        );
    });

    it("surfaces chat error events so BullMQ retries them", async () => {
        const ports = dependencies();
        ports.chat.send = async function* () { yield { type: "error", message: "provider unavailable" }; };
        const operations = new ConcreteApplicationJobOperations(ports.csv, ports.chat, ports.titles, ports.titleStore, ports.favicons, ports.logos);
        await expect(operations.processChat({
            version: 1, turnId: "11111111-1111-4111-8111-111111111111", teamId, userId,
            conversationId: "conversation-1", message: "Hello", mentions: [], pageContext: null,
        }, new AbortController().signal)).rejects.toThrow("provider unavailable");
    });

    it("generates and compare-and-swaps a sanitized conversation title", async () => {
        const ports = dependencies();
        const operations = new ConcreteApplicationJobOperations(ports.csv, ports.chat, ports.titles, ports.titleStore, ports.favicons, ports.logos);
        const signal = new AbortController().signal;
        await operations.generateChatTitle({
            version: 1, conversationId: "conversation-1", provisionalTitle: "Tell me about planning",
            message: "Tell me about planning", provider: null,
        }, signal);
        expect(ports.titles.generate).toHaveBeenCalledWith("Tell me about planning", signal);
        expect(ports.titleStore.replaceProvisional).toHaveBeenCalledWith("conversation-1", "Tell me about planning", "Quarterly planning");
    });

    it("fetches a public favicon and replaces the company logo", async () => {
        const ports = dependencies();
        const operations = new ConcreteApplicationJobOperations(ports.csv, ports.chat, ports.titles, ports.titleStore, ports.favicons, ports.logos);
        const signal = new AbortController().signal;
        await operations.fetchFavicon({ version: 1, companyId: recordId, teamId, domain: "example.com/path" }, signal);
        expect(ports.favicons.fetch).toHaveBeenCalledWith("https://example.com/favicon.ico", signal);
        expect(ports.logos.replace).toHaveBeenCalledWith(
            { requestId: `favicon:${recordId}`, teamId, userId: teamId }, recordId, ports.file,
        );
    });
});
