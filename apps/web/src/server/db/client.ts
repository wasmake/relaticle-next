import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getDatabaseUrl, getEnvironment } from "@/server/env";

type SqlClient = ReturnType<typeof postgres>;
type Database = ReturnType<typeof drizzle>;

let sqlClient: SqlClient | undefined;
let database: Database | undefined;

export const getSqlClient = (): SqlClient => {
    const environment = getEnvironment();

    sqlClient ??= postgres(getDatabaseUrl(environment), {
        max: environment.DB_POOL_MAX,
        idle_timeout: 20,
        connect_timeout: 10,
        prepare: false,
    });

    return sqlClient;
};

export const getDatabase = (): Database => {
    database ??= drizzle(getSqlClient());

    return database;
};

export const closeDatabase = async (): Promise<void> => {
    if (sqlClient === undefined) {
        return;
    }

    await sqlClient.end();
    sqlClient = undefined;
    database = undefined;
};
