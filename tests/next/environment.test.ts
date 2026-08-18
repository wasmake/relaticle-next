import { describe, expect, it } from "vitest";

import { getDatabaseUrl, parseEnvironment } from "@/server/env";
import {
    parseWorkerEnvironment,
    workerDatabaseUrl,
} from "../../apps/worker/environment";

describe("environment configuration", () => {
    it("accepts the existing Laravel-style database and Redis variables", () => {
        const environment = parseEnvironment({
            APP_URL: "https://relaticle.test",
            DB_HOST: "postgres",
            DB_PORT: "5432",
            DB_DATABASE: "relaticle",
            DB_USERNAME: "postgres user",
            DB_PASSWORD: "password/with:symbols",
            REDIS_HOST: "redis",
            REDIS_PASSWORD: "null",
            RELATICLE_FEATURE_BILLING: "true",
        });

        expect(getDatabaseUrl(environment)).toBe(
            "postgresql://postgres%20user:password%2Fwith%3Asymbols@postgres:5432/relaticle",
        );
        expect(environment.REDIS_PASSWORD).toBeUndefined();
        expect(environment.REDIS_CACHE_DB).toBe(1);
        expect(environment.BULLMQ_PREFIX).toBe("bull");
        expect(environment.RELATICLE_FEATURE_BILLING).toBe(true);
    });

    it("rejects invalid boolean values instead of silently changing a flag", () => {
        expect(() =>
            parseEnvironment({ RELATICLE_FEATURE_BLOG: "enabled" }),
        ).toThrow();
    });

    it("requires Resend credentials for the production mail worker", () => {
        expect(() =>
            parseWorkerEnvironment({ MAIL_MAILER: "resend" }),
        ).toThrow(/RESEND_KEY/u);
        expect(() =>
            parseWorkerEnvironment({ MAIL_MAILER: "smtp" }),
        ).toThrow();

        const environment = parseWorkerEnvironment({
            MAIL_MAILER: "resend",
            RESEND_KEY: "re_test",
            DB_HOST: "postgres",
            DB_DATABASE: "relaticle",
            DB_USERNAME: "worker user",
            DB_PASSWORD: "secret/value",
            BULLMQ_PREFIX: "relaticle",
        });

        expect(workerDatabaseUrl(environment)).toBe(
            "postgresql://worker%20user:secret%2Fvalue@postgres:5432/relaticle",
        );
        expect(environment.BULLMQ_PREFIX).toBe("relaticle");
    });
});
