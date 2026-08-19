import { parseWorkerEnvironment } from "./environment.js";
import { createProductionWorker } from "./production.js";
import { startProcessHealthServer } from "../../packages/queue/src/health.js";

const main = async (): Promise<void> => {
    const environment = parseWorkerEnvironment(process.env);
    const runtime = await createProductionWorker(environment);
    const health = await startProcessHealthServer(environment.HEALTH_PORT, runtime.isReady);
    let shuttingDown = false;

    const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.info("Stopping BullMQ worker", { signal });
        await runtime.close();
        await health.close();
    };

    process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
    process.once("SIGINT", () => { void shutdown("SIGINT"); });
    console.info("BullMQ workers ready", { queues: ["default", "imports", "chat"] });
    try {
        await runtime.run();
    } finally {
        await Promise.allSettled([runtime.close(), health.close()]);
    }
};

await main();
