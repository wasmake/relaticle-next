import type { Environment } from "@/server/env";
import { getEnvironment } from "@/server/env";
import { parseLaravelAppKeys } from "@/server/auth/compatibility/laravel-encrypter";

import type { HttpAuthConfiguration } from "./types";

const laravelSlug = (value: string): string =>
    value
        .normalize("NFKD")
        .replace(/\p{Mark}+/gu, "")
        .replace(/@/gu, " at ")
        .toLocaleLowerCase("en-US")
        .replace(/[^\p{Letter}\p{Number}]+/gu, "_")
        .replace(/^_+|_+$/gu, "");

export const deriveLaravelSessionCookieName = (appName: string): string =>
    `${laravelSlug(appName)}_session`;

export const createHttpAuthConfiguration = (
    environment: Environment = getEnvironment(),
): HttpAuthConfiguration => {
    const appKeys =
        environment.APP_KEY === undefined
            ? []
            : parseLaravelAppKeys(
                  environment.APP_KEY,
                  environment.APP_PREVIOUS_KEYS,
              );

    return Object.freeze({
        appKeys: Object.freeze(appKeys),
        sessionCookieName:
            environment.SESSION_COOKIE ??
            deriveLaravelSessionCookieName(environment.APP_NAME),
        sessionLifetimeMinutes: environment.SESSION_LIFETIME,
        requireEmailVerification: environment.REQUIRE_EMAIL_VERIFICATION,
    });
};
