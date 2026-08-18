import { describe, expect, it } from "vitest";

import { GET as liveness } from "@/app/up/route";
import { buildReadinessReport } from "@/server/health/readiness";

describe("health endpoints", () => {
    it("keeps liveness independent from external services", async () => {
        const response = liveness();

        expect(response.status).toBe(200);
        await expect(response.text()).resolves.toBe("OK");
    });

    it("reports unavailable when any required dependency is down", async () => {
        const report = await buildReadinessReport(
            {
                database: async (): Promise<void> => undefined,
                redis: async (): Promise<void> => {
                    throw new Error("Redis unavailable");
                },
            },
            100,
        );

        expect(report.status).toBe("unavailable");
        expect(report.checks.database.status).toBe("up");
        expect(report.checks.redis.status).toBe("down");
    });
});
