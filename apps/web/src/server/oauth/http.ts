import { randomUUID } from "node:crypto";

import type { HttpAuthResult } from "@/server/auth/http";

import { OAuthError } from "./types";
import { parseTeamId, type OAuthService } from "./service";

const jsonHeaders = {
    "cache-control": "no-store",
    pragma: "no-cache",
    "content-type": "application/json",
    "access-control-allow-origin": "*",
} as const;

const json = (body: unknown, status = 200, headers?: HeadersInit): Response =>
    new Response(JSON.stringify(body), {
        status,
        headers: { ...jsonHeaders, ...Object.fromEntries(new Headers(headers)) },
    });

const oauthError = (error: unknown): Response => {
    if (error instanceof OAuthError) {
        return json(
            { error: error.code, error_description: error.message },
            error.status,
            error.status === 401
                ? { "www-authenticate": `Bearer error="${error.code}"` }
                : undefined,
        );
    }

    throw error;
};

const objectBody = async (request: Request): Promise<Record<string, unknown>> => {
    try {
        const value = await request.json() as unknown;
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
            throw new Error();
        }
        return value as Record<string, unknown>;
    } catch {
        throw new OAuthError("invalid_client_metadata", "A JSON object is required.");
    }
};

const stringArray = (value: unknown): readonly string[] | undefined =>
    Array.isArray(value) && value.every((item) => typeof item === "string")
        ? value
        : undefined;

export const handleClientRegistration = async (
    request: Request,
    service: OAuthService,
): Promise<Response> => {
    try {
        const body = await objectBody(request);
        const client = await service.registerClient({
            clientName: typeof body.client_name === "string" ? body.client_name : "",
            redirectUris: stringArray(body.redirect_uris) ?? [],
            ...(body.grant_types === undefined
                ? {}
                : { grantTypes: stringArray(body.grant_types) ?? [] }),
            ...(typeof body.token_endpoint_auth_method === "string"
                ? { tokenEndpointAuthMethod: body.token_endpoint_auth_method }
                : {}),
        });

        return json({
            client_id: client.id,
            client_name: client.name,
            redirect_uris: client.redirectUris,
            grant_types: client.grantTypes,
            response_types: ["code"],
            token_endpoint_auth_method: "none",
        }, 201);
    } catch (error) {
        return oauthError(error);
    }
};

type BrowserAuthorization = (
    request: Request,
    teamId: string,
    requestId: string,
) => Promise<HttpAuthResult>;

const authorizationParameters = async (request: Request): Promise<URLSearchParams> => {
    if (request.method === "GET") {
        return new URL(request.url).searchParams;
    }

    return new URLSearchParams(await request.text());
};

const redirectWith = (
    redirectUri: string,
    values: Readonly<Record<string, string | undefined>>,
): Response => {
    const location = new URL(redirectUri);
    for (const [key, value] of Object.entries(values)) {
        if (value !== undefined) {
            location.searchParams.set(key, value);
        }
    }
    return new Response(null, { status: 302, headers: { location: location.toString(), "cache-control": "no-store" } });
};

const escapeHtml = (value: string): string =>
    value.replace(/[&<>"]/gu, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
    })[character] ?? character);

const consentResponse = (
    request: Request,
    parameters: URLSearchParams,
    clientName: string,
    workspaceName: string,
    scopes: readonly string[],
): Response => {
    const hidden = [...parameters.entries()]
        .filter(([name]) => name !== "decision")
        .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
        .join("");
    const scopeItems = scopes
        .map((scope) => `<li><code>${escapeHtml(scope)}</code></li>`)
        .join("");
    const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize ${escapeHtml(clientName)}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:38rem;margin:10vh auto;padding:1.5rem;color:#17202a}main{border:1px solid #d5d8dc;border-radius:12px;padding:2rem}button{padding:.7rem 1rem;border-radius:7px;border:1px solid #566573;background:#fff;margin-right:.5rem}button[value=approve]{background:#17202a;color:#fff}code{background:#f2f3f4;padding:.15rem .35rem;border-radius:4px}</style></head><body><main><h1>Authorize ${escapeHtml(clientName)}</h1><p>Allow this client to access the <strong>${escapeHtml(workspaceName)}</strong> workspace with these abilities:</p><ul>${scopeItems}</ul><form method="post" action="${escapeHtml(new URL(request.url).pathname)}">${hidden}<button type="submit" name="decision" value="approve">Allow access</button><button type="submit" name="decision" value="deny">Deny</button></form></main></body></html>`;

    return new Response(body, {
        status: 200,
        headers: {
            "cache-control": "no-store",
            "content-type": "text/html; charset=utf-8",
            "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
            "x-content-type-options": "nosniff",
        },
    });
};

export const handleAuthorization = async (
    request: Request,
    service: OAuthService,
    authorizeBrowser: BrowserAuthorization,
): Promise<Response> => {
    try {
        const parameters = await authorizationParameters(request);
        const clientId = parameters.get("client_id") ?? "";
        const redirectUri = parameters.get("redirect_uri") ?? "";
        const validation = await service.validateAuthorization({
            clientId,
            redirectUri,
            responseType: parameters.get("response_type") ?? "",
            codeChallenge: parameters.get("code_challenge") ?? "",
            codeChallengeMethod: parameters.get("code_challenge_method") ?? "",
            ...(parameters.get("scope") === null ? {} : { scope: parameters.get("scope") ?? "" }),
        });
        const teamId = parseTeamId(parameters.get("team_id"));
        const authentication = await authorizeBrowser(request, teamId, randomUUID());

        if (!authentication.ok) {
            const url = new URL(request.url);
            const next = `${url.pathname}${url.search}`;
            return new Response(null, {
                status: 302,
                headers: {
                    location: `${url.origin}/app/login?next=${encodeURIComponent(next)}`,
                    "cache-control": "no-store",
                },
            });
        }

        if (request.method === "GET") {
            return consentResponse(
                request,
                parameters,
                validation.client.name,
                authentication.team.name,
                validation.scopes,
            );
        }

        if (parameters.get("decision") !== "approve") {
            return redirectWith(redirectUri, {
                error: "access_denied",
                error_description: "The resource owner denied the request.",
                state: parameters.get("state") ?? undefined,
            });
        }

        const code = await service.authorize({
            userId: authentication.context.userId,
            teamId: authentication.context.teamId,
            clientId,
            redirectUri,
            codeChallenge: parameters.get("code_challenge") ?? "",
            scopes: validation.scopes,
        });

        return redirectWith(redirectUri, {
            code,
            state: parameters.get("state") ?? undefined,
        });
    } catch (error) {
        return oauthError(error);
    }
};

const formParameters = async (request: Request): Promise<URLSearchParams> => {
    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
    if (contentType !== "application/x-www-form-urlencoded") {
        throw new OAuthError("invalid_request", "Form-encoded request data is required.");
    }
    return new URLSearchParams(await request.text());
};

export const handleTokenExchange = async (
    request: Request,
    service: OAuthService,
): Promise<Response> => {
    try {
        const form = await formParameters(request);
        const grantType = form.get("grant_type");
        let result: Readonly<Record<string, unknown>>;

        if (grantType === "authorization_code") {
            result = await service.exchangeAuthorizationCode({
                code: form.get("code") ?? "",
                clientId: form.get("client_id") ?? "",
                redirectUri: form.get("redirect_uri") ?? "",
                codeVerifier: form.get("code_verifier") ?? "",
            });
        } else if (grantType === "refresh_token") {
            result = await service.exchangeRefreshToken({
                refreshToken: form.get("refresh_token") ?? "",
                clientId: form.get("client_id") ?? "",
                ...(form.get("scope") === null ? {} : { scope: form.get("scope") ?? "" }),
            });
        } else {
            throw new OAuthError("unsupported_grant_type", "The grant type is unsupported.");
        }

        return json(result);
    } catch (error) {
        return oauthError(error);
    }
};

export const handleRevocation = async (
    request: Request,
    service: OAuthService,
): Promise<Response> => {
    try {
        const form = await formParameters(request);
        await service.revoke(form.get("token") ?? "", form.get("client_id") ?? "");
        return new Response(null, { status: 200, headers: jsonHeaders });
    } catch (error) {
        return oauthError(error);
    }
};

export const authorizationServerMetadata = (origin: string) => ({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["read", "create", "update", "delete"],
});

export const protectedResourceMetadata = (origin: string) => ({
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: ["read", "create", "update", "delete"],
});

export const oauthJson = json;
