#!/usr/bin/env node

import { parseSchedulerEnvironment } from "./environment.js";
import { createProductionScheduler } from "./production.js";
import { startProcessHealthServer } from "../../packages/queue/src/health.js";

const main = async (): Promise<void> => {
    const environment = parseSchedulerEnvironment(process.env);
    const runtime = await createProductionScheduler(environment);
    const health = await startProcessHealthServer(environment.HEALTH_PORT, runtime.isReady);
    let shuttingDown = false;

    const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
        if (shuttingDown) {
            return;
        }

        shuttingDown = true;
        console.info("Stopping scheduler", { signal });
        await runtime.close();
        await health.close();
    };

    process.once("SIGTERM", () => {
        void shutdown("SIGTERM");
    });
    process.once("SIGINT", () => {
        void shutdown("SIGINT");
    });

    if (runtime.unimplementedHandlers.length > 0) {
        console.warn("Scheduler contracts without handlers", {
            jobKeys: runtime.unimplementedHandlers,
        });
    }

    runtime.start();
    console.info("Scheduler ready");
};

main().catch((error: unknown) => {
    console.error("Scheduler terminated", {
        error: error instanceof Error ? error.message : "Unknown error",
    });
    process.exitCode = 1;
});
