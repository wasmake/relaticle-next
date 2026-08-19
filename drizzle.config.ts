import { defineConfig } from "drizzle-kit";

export default defineConfig({
    dialect: "postgresql",
    schema: "./apps/web/src/server/db/schema/index.ts",
    out: "./drizzle",
    dbCredentials: {
        url:
            process.env.DATABASE_URL ??
            "postgresql://postgres:postgres@127.0.0.1:5432/relaticle",
    },
    strict: true,
    verbose: true,
});
