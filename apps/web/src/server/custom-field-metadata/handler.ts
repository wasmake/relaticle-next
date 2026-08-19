import { jsonApiResponse, jsonResponse } from "@/server/api/errors";
import { handleAuthenticatedApiRequest, type ApiAccessResolver } from "@/server/api/http";

import { parseCustomFieldMetadataQuery } from "./query";
import { customFieldMetadataDocument } from "./resource";
import type { CustomFieldMetadataService } from "./service";

export type CustomFieldMetadataApiDependencies = Readonly<{
    auth: ApiAccessResolver;
    customFields: CustomFieldMetadataService;
}>;

export const handleCustomFieldMetadataRequest = (
    request: Request,
    dependencies: CustomFieldMetadataApiDependencies,
): Promise<Response> =>
    handleAuthenticatedApiRequest(request, dependencies.auth, async ({ context }, requestId) => {
        if (request.method !== "GET") {
            return jsonResponse({ message: "Method Not Allowed" }, 405, requestId);
        }

        const url = new URL(request.url);
        const result = await dependencies.customFields.list(
            context,
            parseCustomFieldMetadataQuery(url),
        );
        return jsonApiResponse(customFieldMetadataDocument(result, url), 200, requestId);
    });
