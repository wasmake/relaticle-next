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

const optionalUrl = z.preprocess(
    emptyStringAsUndefined,
    z.url().optional(),
);
const environmentBoolean = (fallback: boolean) => z.preprocess((value: unknown): unknown => {
    const normalized = emptyStringAsUndefined(value);
    if (normalized === undefined) return fallback;
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
    return normalized;
}, z.boolean());

const workerEnvironmentSchema = z
    .object({
        APP_URL: z.url().default("http://localhost"),
        APP_KEY: optionalString,
        APP_PREVIOUS_KEYS: optionalString,
        APP_PANEL_DOMAIN: optionalString,
        APP_PANEL_PATH: z.string().min(1).default("app"),
        DATABASE_URL: optionalUrl,
        DB_HOST: z.string().min(1).default("127.0.0.1"),
        DB_PORT: z.coerce.number().int().min(1).max(65_535).default(5432),
        DB_DATABASE: z.string().min(1).default("relaticle"),
        DB_USERNAME: z.string().min(1).default("postgres"),
        DB_PASSWORD: z.string().default("postgres"),
        DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
        REDIS_URL: optionalUrl,
        REDIS_HOST: z.string().min(1).default("127.0.0.1"),
        REDIS_PORT: z.coerce.number().int().min(1).max(65_535).default(6379),
        REDIS_USERNAME: optionalString,
        REDIS_PASSWORD: optionalString,
        REDIS_DB: z.coerce.number().int().min(0).default(0),
        BULLMQ_PREFIX: z.string().min(1).default("bull"),
        HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
        REDIS_PREFIX: z.string().default(""),
        MAILCOACH_API_ENDPOINT: optionalUrl,
        MAILCOACH_API_TOKEN: optionalString,
        ACTIVITYLOG_ENABLED: environmentBoolean(true),
        ANTHROPIC_API_KEY: optionalString,
        ANTHROPIC_BASE_URL: z.url().default("https://api.anthropic.com/v1"),
        ANTHROPIC_MODEL: z.string().min(1).default("claude-sonnet-4-5"),
        OPENAI_API_KEY: optionalString,
        OPENAI_BASE_URL: z.url().default("https://api.openai.com/v1"),
        OPENAI_MODEL: z.string().min(1).default("gpt-4.1"),
        OLLAMA_URL: z.url().default("http://127.0.0.1:11434"),
        OLLAMA_MODEL: z.string().min(1).default("llama3.1"),
        OPENAI_COMPATIBLE_URL: z.url().default("http://127.0.0.1:8080/v1"),
        OPENAI_COMPATIBLE_KEY: optionalString,
        OPENAI_COMPATIBLE_MODELS: z.string().default(""),
        MAIL_MAILER: z.enum(["resend", "log"]).default("log"),
        MAIL_FROM_ADDRESS: z.email().default("hello@example.com"),
        MAIL_FROM_NAME: z.string().min(1).default("Relaticle"),
        RESEND_KEY: optionalString,
    })
    .superRefine((environment, context) => {
        if (
            environment.MAIL_MAILER === "resend" &&
            environment.RESEND_KEY === undefined
        ) {
            context.addIssue({
                code: "custom",
                path: ["RESEND_KEY"],
                message: "RESEND_KEY is required when MAIL_MAILER=resend.",
            });
        }
    });

export type WorkerEnvironment = z.infer<typeof workerEnvironmentSchema>;

export const parseWorkerEnvironment = (
    source: Readonly<Record<string, string | undefined>>,
): WorkerEnvironment => workerEnvironmentSchema.parse(source);

export const workerDatabaseUrl = (environment: WorkerEnvironment): string => {
    if (environment.DATABASE_URL !== undefined) {
        return environment.DATABASE_URL;
    }

    const username = encodeURIComponent(environment.DB_USERNAME);
    const password = encodeURIComponent(environment.DB_PASSWORD);
    const database = encodeURIComponent(environment.DB_DATABASE);

    return `postgresql://${username}:${password}@${environment.DB_HOST}:${environment.DB_PORT}/${database}`;
};
