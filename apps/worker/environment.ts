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

const workerEnvironmentSchema = z
    .object({
        APP_URL: z.url().default("http://localhost"),
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
