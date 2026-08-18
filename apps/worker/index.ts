import { parseWorkerEnvironment } from "./environment.js";
import { createProductionWorker } from "./production.js";

const main = async (): Promise<void> => {
    const environment = parseWorkerEnvironment(process.env);
    const runtime = await createProductionWorker(environment);
    let shuttingDown = false;

    const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
        if (shuttingDown) {
            return;
        }

        shuttingDown = true;
        console.info("Stopping BullMQ worker", { signal });
        await runtime.close();
    };

    process.once("SIGTERM", () => {
        void shutdown("SIGTERM");
    });
    process.once("SIGINT", () => {
        void shutdown("SIGINT");
    });

    console.info("BullMQ worker ready", { queue: "default" });
    await runtime.worker.run();
};

main().catch((error: unknown) => {
    console.error("BullMQ worker terminated", {
        error: error instanceof Error ? error.message : "Unknown error",
    });
    process.exitCode = 1;
});
