import { randomUUID } from "node:crypto";

import type { HttpAuthSuccess } from "@/server/auth/http";
import {
    apiAbilityForHttpMethod,
} from "@/server/auth/http";
import { hasApiAbility } from "@/server/context/request-context";

import type { ApiAccessResolver } from "./access";
import {
    ApiBadRequestError,
    ApiValidationError,
    errorResponse,
    jsonResponse,
} from "./errors";

export type { ApiAccessResolver } from "./access";
export { apiAccessFromHttpAuthResult } from "./access";
export type ApiAuthSuccess = HttpAuthSuccess;

export type AuthenticatedApiHandler = (
    authentication: ApiAuthSuccess,
    requestId: string,
) => Promise<Response>;

const requestIdFor = (request: Request): string => {
    const supplied = request.headers.get("x-request-id")?.trim();

    return supplied === undefined || supplied === "" ? randomUUID() : supplied;
};

const readingMethods = new Set(["GET", "HEAD", "OPTIONS"]);

const hasValidSessionWriteOrigin = (request: Request): boolean => {
    if (readingMethods.has(request.method.toUpperCase())) {
        return true;
    }

    if (request.headers.get("sec-fetch-site") === "same-origin") {
        return true;
    }

    return false;
};

export const handleAuthenticatedApiRequest = async (
    request: Request,
    accessResolver: ApiAccessResolver,
    handler: AuthenticatedApiHandler,
): Promise<Response> => {
    const requestId = requestIdFor(request);

    try {
        const access = await accessResolver.resolve(request, requestId);

        if (!access.allowed) {
            return jsonResponse(
                access.body,
                access.status,
                requestId,
                undefined,
                access.headers,
            );
        }

        const { authentication } = access;

        if (
            authentication.context.credential.kind === "session" &&
            !hasValidSessionWriteOrigin(request)
        ) {
            return jsonResponse(
                { message: "CSRF token mismatch." },
                419,
                requestId,
            );
        }

        const ability = apiAbilityForHttpMethod(request.method);

        if (!hasApiAbility(authentication.context, ability)) {
            return jsonResponse({ message: "Forbidden." }, 403, requestId);
        }

        const response = await handler(authentication, requestId);

        for (const [name, value] of Object.entries(access.headers)) {
            response.headers.set(name, value);
        }

        return response;
    } catch (error) {
        return errorResponse(error, requestId);
    }
};

export const parseJsonObject = async (
    request: Request,
): Promise<Readonly<Record<string, unknown>>> => {
    const text = await request.text();
    let parsed: unknown = {};

    if (text.trim() !== "") {
        try {
            parsed = JSON.parse(text) as unknown;
        } catch {
            throw new ApiBadRequestError("Malformed JSON request body.");
        }
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new ApiValidationError([
            { path: "body", message: "The request body must be an object." },
        ]);
    }

    return normalizeLaravelInput(parsed) as Readonly<Record<string, unknown>>;
};

const normalizeLaravelInput = (value: unknown): unknown => {
    if (typeof value === "string") {
        const trimmed = value.trim();

        return trimmed === "" ? null : trimmed;
    }

    if (Array.isArray(value)) {
        return value.map(normalizeLaravelInput);
    }

    if (typeof value === "object" && value !== null) {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
                key,
                normalizeLaravelInput(item),
            ]),
        );
    }

    return value;
};
