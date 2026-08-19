import { CustomFieldValidationError } from "@/server/custom-fields/types";
import { RequestBodyTooLargeError } from "@/server/http/body";

export type ApiValidationIssue = Readonly<{
    path: string;
    message: string;
}>;

export class ApiBadRequestError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = "ApiBadRequestError";
    }
}

export class ApiNotFoundError extends Error {
    public constructor() {
        super("Not Found");
        this.name = "ApiNotFoundError";
    }
}

export class ApiValidationError extends Error {
    public constructor(public readonly issues: readonly ApiValidationIssue[]) {
        super(issues.map(({ path, message }) => `${path}: ${message}`).join("; "));
        this.name = "ApiValidationError";
    }
}

const validationErrors = (
    issues: readonly ApiValidationIssue[],
): Readonly<Record<string, readonly string[]>> => {
    const errors: Record<string, string[]> = {};

    for (const issue of issues) {
        (errors[issue.path] ??= []).push(issue.message);
    }

    return errors;
};

export const errorResponse = (error: unknown, requestId: string): Response => {
    if (error instanceof RequestBodyTooLargeError) {
        return jsonResponse({ message: error.message }, 413, requestId);
    }

    if (error instanceof ApiBadRequestError) {
        return jsonResponse({ message: error.message }, 400, requestId);
    }

    if (error instanceof ApiNotFoundError) {
        return jsonResponse({ message: "Not Found" }, 404, requestId);
    }

    if (
        error instanceof ApiValidationError ||
        error instanceof CustomFieldValidationError
    ) {
        const errors = validationErrors(error.issues);
        const firstMessage = error.issues[0]?.message ?? "The given data was invalid.";

        return jsonResponse(
            { message: firstMessage, errors },
            422,
            requestId,
        );
    }

    console.error("Unhandled API request error", { requestId, error });

    return jsonResponse({ message: "Server Error" }, 500, requestId);
};

export const jsonResponse = (
    body: unknown,
    status: number,
    requestId: string,
    contentType = "application/json; charset=utf-8",
    additionalHeaders: HeadersInit = {},
): Response => {
    const headers = new Headers(additionalHeaders);
    headers.set("cache-control", "no-store");
    headers.set("content-type", contentType);
    headers.set("x-request-id", requestId);

    return new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers,
    });
};

export const jsonApiResponse = (
    body: unknown,
    status: number,
    requestId: string,
): Response =>
    jsonResponse(
        body,
        status,
        requestId,
        "application/vnd.api+json",
    );
