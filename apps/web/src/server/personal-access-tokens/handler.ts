import { jsonApiResponse, jsonResponse } from "@/server/api/errors";
import {
    handleAuthenticatedApiRequest,
    parseJsonObject,
    type ApiAccessResolver,
} from "@/server/api/http";

import { personalAccessTokenResource } from "./resource";
import type { PersonalAccessTokensService } from "./service";

export type PersonalAccessTokensApiDependencies = Readonly<{
    auth: ApiAccessResolver;
    tokens: PersonalAccessTokensService;
}>;

export const handlePersonalAccessTokensCollectionRequest = (
    request: Request,
    dependencies: PersonalAccessTokensApiDependencies,
): Promise<Response> =>
    handleAuthenticatedApiRequest(request, dependencies.auth, async ({ context }, requestId) => {
        if (request.method === "GET") {
            const tokens = await dependencies.tokens.list(context);
            return jsonApiResponse(
                { data: tokens.map(personalAccessTokenResource) },
                200,
                requestId,
            );
        }

        if (request.method === "POST") {
            const result = await dependencies.tokens.create(
                context,
                await parseJsonObject(request),
            );
            return jsonApiResponse(
                {
                    data: personalAccessTokenResource(result.token),
                    plain_text_token: result.plainTextToken,
                },
                201,
                requestId,
            );
        }

        return jsonResponse({ message: "Method Not Allowed" }, 405, requestId);
    });

export const handlePersonalAccessTokenRequest = (
    request: Request,
    tokenId: string,
    dependencies: PersonalAccessTokensApiDependencies,
): Promise<Response> =>
    handleAuthenticatedApiRequest(request, dependencies.auth, async ({ context }, requestId) => {
        if (request.method !== "DELETE") {
            return jsonResponse({ message: "Method Not Allowed" }, 405, requestId);
        }
        await dependencies.tokens.delete(context, tokenId);
        return jsonResponse(null, 204, requestId);
    });
