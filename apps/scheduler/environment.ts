import { z } from "zod";

const emptyStringAsUndefined = (value: unknown): unknown => {
    if (typeof value !== "string") {
        return value;
    }

    const normalized = value.trim();
    return normalized === "" || normalized === "null" ? undefined : normalized;
};

const optionalString = z.preprocess(
    emptyStringAsUndefined,
    z.string().min(1).optional(),
);
const optionalUrl = z.preprocess(emptyStringAsUndefined, z.url().optional());
const environmentBoolean = (fallback: boolean) =>
    z.preprocess((value: unknown): unknown => {
        const normalized = emptyStringAsUndefined(value);
        if (normalized === undefined) return fallback;
        if (normalized === "true" || normalized === "1") return true;
        if (normalized === "false" || normalized === "0") return false;
        return normalized;
    }, z.boolean());

const schedulerEnvironmentSchema = z.object({
    DATABASE_URL: optionalUrl,
    DB_HOST: z.string().min(1).default("127.0.0.1"),
    DB_PORT: z.coerce.number().int().min(1).max(65_535).default(5432),
    DB_DATABASE: z.string().min(1).default("relaticle"),
    DB_USERNAME: z.string().min(1).default("postgres"),
    DB_PASSWORD: z.string().default("postgres"),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(5),
    REDIS_URL: optionalUrl,
    REDIS_HOST: z.string().min(1).default("127.0.0.1"),
    REDIS_PORT: z.coerce.number().int().min(1).max(65_535).default(6379),
    REDIS_USERNAME: optionalString,
    REDIS_PASSWORD: optionalString,
    REDIS_DB: z.coerce.number().int().min(0).default(0),
    REDIS_PREFIX: z.string().default(""),
    BULLMQ_PREFIX: z.string().min(1).default("bull"),
    CSV_IMPORTS_PATH: z.string().min(1).default("storage/app/csv/imports"),
    HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(3002),
    SCHEDULER_OPERATION_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(86_400_000).default(900_000),
    APP_URL: z.url().default("http://localhost:3000"),
    APP_TIMEZONE: z.string().min(1).default("UTC"),
    APP_PANEL_PATH: z.string().min(1).default("app"),
    DISPOSABLE_DOMAINS_URL: z
        .url()
        .default("https://cdn.jsdelivr.net/gh/disposable/disposable-email-domains@master/domains.json"),
    DISPOSABLE_DOMAINS_PATH: z
        .string()
        .min(1)
        .default("storage/framework/disposable_domains.json"),
    MAILCOACH_ENABLED_SUBSCRIBERS_SYNC: environmentBoolean(false),
    MAILCOACH_API_TOKEN: optionalString,
    MAILCOACH_API_ENDPOINT: optionalUrl,
    MAIL_MAILER: z.enum(["resend", "log"]).default("log"),
    MAIL_FROM_ADDRESS: z.email().default("hello@example.com"),
    MAIL_FROM_NAME: z.string().min(1).default("Relaticle"),
    RESEND_KEY: optionalString,
    STRIPE_SECRET: optionalString,
    HEALTH_CHECK_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(2_000),
});

export type SchedulerEnvironment = z.infer<typeof schedulerEnvironmentSchema>;

export const parseSchedulerEnvironment = (
    source: Readonly<Record<string, string | undefined>>,
): SchedulerEnvironment => schedulerEnvironmentSchema.parse(source);

export const schedulerDatabaseUrl = (environment: SchedulerEnvironment): string => {
    if (environment.DATABASE_URL !== undefined) {
        return environment.DATABASE_URL;
    }

    const username = encodeURIComponent(environment.DB_USERNAME);
    const password = encodeURIComponent(environment.DB_PASSWORD);
    const database = encodeURIComponent(environment.DB_DATABASE);

    return `postgresql://${username}:${password}@${environment.DB_HOST}:${environment.DB_PORT}/${database}`;
};
