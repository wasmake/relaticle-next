import postgres from "postgres";

import type { WorkerEnvironment } from "./environment.js";
import { workerDatabaseUrl } from "./environment.js";

export type WorkerSqlClient = ReturnType<typeof postgres>;

export const createWorkerSqlClient = (
    environment: WorkerEnvironment,
): WorkerSqlClient =>
    postgres(workerDatabaseUrl(environment), {
        max: environment.DB_POOL_MAX,
        idle_timeout: 20,
        connect_timeout: 10,
        prepare: false,
    });
