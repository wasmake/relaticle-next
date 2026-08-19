import { afterEach, describe, expect, it, vi } from "vitest";

import { parseWorkerEnvironment } from "../../apps/worker/environment";
import { ProductionOutboundOperations, type ApplicationJobOperations } from "../../apps/worker/jobs/outbound-operations";
import type { WorkerSqlClient } from "../../apps/worker/database";

const sqlClient = (queries: unknown[][]): WorkerSqlClient => ((strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push([strings, ...values]);
    return Promise.resolve([]);
}) as unknown as WorkerSqlClient;

const applicationOperations: ApplicationJobOperations = {
    exportCsv: async () => undefined,
    importCsv: async () => undefined,
    processChat: async () => undefined,
    generateChatTitle: async () => undefined,
    fetchFavicon: async () => undefined,
};

describe("account outbound operations", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("logs account mail when the log transport is configured", async () => {
        const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
        const operations = new ProductionOutboundOperations(sqlClient([]), parseWorkerEnvironment({ MAIL_MAILER: "log" }), applicationOperations);
        await operations.sendEmail({ version: 1, deliveryId: "delivery-1", to: "ada@example.test", subject: "Verify", html: "<p>Verify</p>", text: "Verify" });
        expect(info).toHaveBeenCalledWith("BullMQ email logged", { deliveryId: "delivery-1", to: "ada@example.test", subject: "Verify" });
    });

    it("persists a nested Mailcoach subscriber UUID returned by the API", async () => {
        const queries: unknown[][] = [];
        let requestedUrl: string | undefined;
        const request = vi.fn(async (input: string | URL | Request) => {
            requestedUrl = String(input);
            return Response.json({ data: { uuid: "subscriber-uuid" } });
        });
        vi.stubGlobal("fetch", request);
        const operations = new ProductionOutboundOperations(sqlClient(queries), parseWorkerEnvironment({
            MAILCOACH_API_ENDPOINT: "https://mail.example.test/api/list/",
            MAILCOACH_API_TOKEN: "token",
        }), applicationOperations);
        await operations.syncMailcoachSubscriber({
            version: 1,
            email: "ada@example.test",
            userId: "01J00000000000000000000000",
            firstName: "Ada",
            tags: ["registered"],
            attributes: {},
        }, new AbortController().signal);
        expect(request).toHaveBeenCalledOnce();
        expect(requestedUrl).toBe("https://mail.example.test/api/list/subscribers/sync");
        expect(queries).toHaveLength(1);
        expect(queries[0]).toContain("subscriber-uuid");
    });
});
