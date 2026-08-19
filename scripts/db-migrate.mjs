import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const databaseUrl =
    process.env.DATABASE_URL ??
    `postgresql://${encodeURIComponent(process.env.DB_USERNAME ?? "postgres")}:${encodeURIComponent(process.env.DB_PASSWORD ?? "postgres")}@${process.env.DB_HOST ?? "127.0.0.1"}:${process.env.DB_PORT ?? "5432"}/${process.env.DB_DATABASE ?? "relaticle"}`;
const client = postgres(databaseUrl, { max: 1, prepare: false });

try {
    await migrate(drizzle(client), { migrationsFolder: "drizzle" });
} finally {
    await client.end();
}
