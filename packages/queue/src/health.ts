import { createServer, type Server } from "node:http";

export interface ProcessHealthServer {
    readonly port: number;
    close(): Promise<void>;
}

export const startProcessHealthServer = async (
    port: number,
    ready: () => boolean,
): Promise<ProcessHealthServer> => {
    const server = createServer((request, response) => {
        const live = request.url === "/health/live";
        const readiness = request.url === "/health/ready";
        if (!live && !readiness) {
            response.writeHead(404).end();
            return;
        }
        const ok = live || ready();
        response.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: ok ? "ok" : "unavailable" }));
    });

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "0.0.0.0", () => {
            server.off("error", reject);
            resolve();
        });
    });

    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Health server did not bind a TCP port.");
    let closed = false;
    return {
        port: address.port,
        close: async () => {
            if (closed) return;
            closed = true;
            await closeServer(server);
        },
    };
};

const closeServer = (server: Server): Promise<void> =>
    new Promise((resolve, reject) => {
        server.close((error) => error === undefined ? resolve() : reject(error));
    });
