import { describe, expect, it } from "vitest";

import { startProcessHealthServer } from "../../packages/queue/src/health";

describe("process health server", () => {
    it("separates liveness from runtime readiness", async () => {
        let ready = false;
        const server = await startProcessHealthServer(0, () => ready);

        try {
            await expect(fetch(`http://127.0.0.1:${server.port}/health/live`).then((response) => response.status)).resolves.toBe(200);
            await expect(fetch(`http://127.0.0.1:${server.port}/health/ready`).then((response) => response.status)).resolves.toBe(503);
            ready = true;
            await expect(fetch(`http://127.0.0.1:${server.port}/health/ready`).then((response) => response.status)).resolves.toBe(200);
        } finally {
            await server.close();
        }
    });
});
