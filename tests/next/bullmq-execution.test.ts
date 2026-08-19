import { describe, expect, it, vi } from "vitest";

import { createDurableProcessors, type DurableJobOperations } from "../../apps/worker/jobs/durable-jobs";
import { assertCompleteProcessorRegistry } from "../../apps/worker/worker";
import { enqueueChatTurn } from "../../apps/web/src/server/chat/handler";
import {
    chatProcessJobName,
    csvExportJobName,
    durableJobId,
    genericEmailJobNames,
    handledJobNames,
    jobOptionsFor,
    queueJobContracts,
} from "../../packages/queue/src/jobs";

describe("BullMQ execution contracts", () => {
    it("has a unique processor contract for every durable job", () => {
        expect(new Set(handledJobNames).size).toBe(handledJobNames.length);
        expect(queueJobContracts.filter(({ queue }) => queue === "default").length).toBeGreaterThan(10);
        expect(queueJobContracts.filter(({ queue }) => queue === "imports").map(({ name }) => name)).toEqual(["csv.export", "csv.import"]);
        expect(queueJobContracts.filter(({ queue }) => queue === "chat").map(({ name }) => name)).toEqual(["chat.message.process"]);
        expect(queueJobContracts.map(({ name }) => name)).not.toEqual(expect.arrayContaining(["chat.title.generate", "company.favicon.fetch"]));
        expect(genericEmailJobNames).toContain("task.digest.email");
    });

    it("creates stable safe IDs and job-specific retry policies", () => {
        const first = durableJobId(csvExportJobName, "tenant:job/one");
        expect(first).toBe(durableJobId(csvExportJobName, "tenant:job/one"));
        expect(first).not.toMatch(/[:/]/u);
        expect(jobOptionsFor(csvExportJobName, "job")).toMatchObject({ attempts: 2, backoff: { type: "exponential", delay: 5_000 } });
        expect(jobOptionsFor(chatProcessJobName, "turn")).toMatchObject({ attempts: 5, backoff: { type: "exponential", delay: 2_000 } });
    });

    it("validates payloads before invoking reusable operations", async () => {
        const exportCsv = vi.fn(async () => undefined);
        const operations = new Proxy({ exportCsv } as unknown as DurableJobOperations, {
            get(target, property) {
                if (property in target) return target[property as keyof DurableJobOperations];
                return vi.fn(async () => undefined);
            },
        });
        const processors = createDurableProcessors(operations);
        const bullJob = { id: "job", name: csvExportJobName } as never;
        await processors.csvExport.process({
            version: 1, jobId: "01J00000000000000000000001", resource: "companies",
            context: { requestId: "request", teamId: "01J00000000000000000000002", userId: "01J00000000000000000000003", abilities: ["read"] },
        }, bullJob);
        expect(exportCsv).toHaveBeenCalledOnce();
        await expect(processors.csvExport.process({ version: 1 }, bullJob)).rejects.toThrow();
        expect(exportCsv).toHaveBeenCalledOnce();
    });

    it("reports a drifted processor registry", () => {
        expect(() => assertCompleteProcessorRegistry({})).toThrow(/csv\.export/u);
    });

    it("enqueues chat turns through the declared chat contract", async () => {
        const add = vi.fn(async () => undefined);
        const turnId = "11111111-1111-4111-8111-111111111111";
        await enqueueChatTurn({ add }, {
            teamId: "01J00000000000000000000001",
            userId: "01J00000000000000000000002",
            conversationId: "conversation-1",
            message: "Summarize Acme",
            mentions: [],
            pageContext: null,
        }, turnId);

        expect(add).toHaveBeenCalledWith(chatProcessJobName, expect.objectContaining({ version: 1, turnId }), expect.objectContaining({ attempts: 5 }));
    });
});
