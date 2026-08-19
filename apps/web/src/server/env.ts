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

const publicHttpUrl = z.url().refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
}, "Must be an HTTP or HTTPS URL.");

const environmentBoolean = (defaultValue: boolean) =>
    z
        .preprocess((value: unknown): unknown => {
            const normalized = emptyStringAsUndefined(value);

            if (normalized === undefined) {
                return defaultValue;
            }

            if (normalized === "true" || normalized === "1") {
                return true;
            }

            if (normalized === "false" || normalized === "0") {
                return false;
            }

            return normalized;
        }, z.boolean());

const environmentSchema = z.object({
    NODE_ENV: z
        .enum(["development", "test", "production"])
        .default("development"),
    APP_NAME: z.string().min(1).default("Relaticle"),
    APP_URL: publicHttpUrl.default("http://localhost:3000"),
    APP_KEY: optionalString,
    APP_PREVIOUS_KEYS: optionalString,
    APP_TIMEZONE: z.string().min(1).default("UTC"),
    APP_PANEL_DOMAIN: optionalString,
    APP_PANEL_PATH: z.string().min(1).default("app"),
    API_DOMAIN: optionalString,
    MCP_DOMAIN: optionalString,
    SYSADMIN_DOMAIN: optionalString,
    SYSADMIN_PATH: z.string().min(1).default("sysadmin"),
    SESSION_COOKIE: optionalString,
    SESSION_LIFETIME: z.coerce.number().int().min(1).default(120),
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
    REDIS_CACHE_DB: z.coerce.number().int().min(0).default(1),
    REDIS_PREFIX: optionalString,
    CACHE_PREFIX: optionalString,
    BULLMQ_PREFIX: z.string().min(1).default("bull"),
    HEALTH_CHECK_TIMEOUT_MS: z.coerce
        .number()
        .int()
        .min(100)
        .max(30_000)
        .default(2_000),
    ACTIVITYLOG_ENABLED: environmentBoolean(true),
    REQUIRE_EMAIL_VERIFICATION: environmentBoolean(true),
    REMEMBER_ME_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    MAIL_MAILER: z.enum(["resend", "log"]).default("log"),
    MAIL_FROM_ADDRESS: z.email().default("hello@example.com"),
    MAIL_FROM_NAME: z.string().min(1).default("Relaticle"),
    RESEND_KEY: optionalString,
    TURNSTILE_SITE_KEY: optionalString,
    TURNSTILE_SECRET_KEY: optionalString,
    GITHUB_CLIENT_ID: optionalString,
    GITHUB_CLIENT_SECRET: optionalString,
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    MAILCOACH_API_ENDPOINT: optionalUrl,
    MAILCOACH_API_TOKEN: optionalString,
    MAILCOACH_ENABLED_SUBSCRIBERS_SYNC: environmentBoolean(false),
    RELATICLE_FEATURE_BILLING: environmentBoolean(false),
    RELATICLE_FEATURE_BLOG: environmentBoolean(true),
    RELATICLE_FEATURE_DOCUMENTATION: environmentBoolean(true),
    RELATICLE_FEATURE_ONBOARD_SEED: environmentBoolean(true),
    RELATICLE_FEATURE_SOCIAL_AUTH: environmentBoolean(true),
    RELATICLE_FEATURE_SUPPORT_MENU: environmentBoolean(true),
}).superRefine((value, context) => {
    const requirePair = (left: keyof typeof value, right: keyof typeof value) => {
        if ((value[left] === undefined) !== (value[right] === undefined)) {
            context.addIssue({ code: "custom", path: [String(left)], message: `${String(left)} and ${String(right)} must be configured together.` });
        }
    };
    requirePair("GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET");
    requirePair("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET");
    requirePair("TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY");
    if (value.MAIL_MAILER === "resend" && value.RESEND_KEY === undefined) context.addIssue({ code: "custom", path: ["RESEND_KEY"], message: "RESEND_KEY is required when MAIL_MAILER=resend." });
    if (value.MAILCOACH_ENABLED_SUBSCRIBERS_SYNC && (value.MAILCOACH_API_ENDPOINT === undefined || value.MAILCOACH_API_TOKEN === undefined)) context.addIssue({ code: "custom", path: ["MAILCOACH_API_ENDPOINT"], message: "Mailcoach endpoint and token are required when subscriber sync is enabled." });
});

export type Environment = z.infer<typeof environmentSchema>;

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export const parseEnvironment = (
    source: EnvironmentSource,
): Environment => environmentSchema.parse(source);

let environment: Environment | undefined;

export const getEnvironment = (): Environment => {
    environment ??= parseEnvironment(process.env);

    return environment;
};

export const getDatabaseUrl = (env: Environment = getEnvironment()): string => {
    if (env.DATABASE_URL !== undefined) {
        return env.DATABASE_URL;
    }

    const username = encodeURIComponent(env.DB_USERNAME);
    const password = encodeURIComponent(env.DB_PASSWORD);
    const database = encodeURIComponent(env.DB_DATABASE);

    return `postgresql://${username}:${password}@${env.DB_HOST}:${env.DB_PORT}/${database}`;
};

const laravelSlug = (value: string): string =>
    value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/gu, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, "_")
        .replace(/^_+|_+$/gu, "");

export const getLaravelRedisPrefix = (
    env: Environment = getEnvironment(),
): string => env.REDIS_PREFIX ?? `${laravelSlug(env.APP_NAME)}_database_`;

export const getLaravelCachePrefix = (
    env: Environment = getEnvironment(),
): string => env.CACHE_PREFIX ?? `${laravelSlug(env.APP_NAME)}_cache_`;
