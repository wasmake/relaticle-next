import { jsonApiResponse, jsonResponse } from "@/server/api/errors";
import type { ApiAccessResolver } from "@/server/api/http";
import {
    handleAuthenticatedApiRequest,
    parseJsonObject,
} from "@/server/api/http";
import { ulidSchema } from "@/server/ids";

import { parseOpportunityIncludes, parseOpportunityListQuery } from "./query";
import { opportunityCollectionDocument, opportunityDocument } from "./resource";
import type { OpportunitiesService } from "./service";

export type OpportunitiesApiDependencies = Readonly<{
    auth: ApiAccessResolver;
    opportunities: OpportunitiesService;
}>;

const opportunityIdFrom = (value: string) => {
    const parsed = ulidSchema.safeParse(value);

    return parsed.success ? parsed.data : undefined;
};

export const handleOpportunitiesCollectionRequest = (
    request: Request,
    dependencies: OpportunitiesApiDependencies,
): Promise<Response> =>
    handleAuthenticatedApiRequest(
        request,
        dependencies.auth,
        async ({ context }, requestId) => {
            const url = new URL(request.url);

            if (request.method === "GET") {
                const query = parseOpportunityListQuery(url);
                const result = await dependencies.opportunities.list(
                    context,
                    query,
                );

                return jsonApiResponse(
                    opportunityCollectionDocument(result, url),
                    200,
                    requestId,
                );
            }

            if (request.method === "POST") {
                const body = await parseJsonObject(request);
                const opportunity = await dependencies.opportunities.create(
                    context,
                    body,
                    parseOpportunityIncludes(url.searchParams),
                );

                return jsonApiResponse(
                    opportunityDocument(opportunity),
                    201,
                    requestId,
                );
            }

            return jsonResponse(
                { message: "Method Not Allowed" },
                405,
                requestId,
            );
        },
    );

export const handleOpportunityRequest = (
    request: Request,
    opportunityId: string,
    dependencies: OpportunitiesApiDependencies,
): Promise<Response> =>
    handleAuthenticatedApiRequest(
        request,
        dependencies.auth,
        async ({ context }, requestId) => {
            const id = opportunityIdFrom(opportunityId);

            if (id === undefined) {
                return jsonResponse({ message: "Not Found" }, 404, requestId);
            }

            const url = new URL(request.url);

            if (request.method === "GET") {
                const opportunity = await dependencies.opportunities.show(
                    context,
                    id,
                    parseOpportunityIncludes(url.searchParams),
                );

                return jsonApiResponse(
                    opportunityDocument(opportunity),
                    200,
                    requestId,
                );
            }

            if (request.method === "PUT" || request.method === "PATCH") {
                const body = await parseJsonObject(request);
                const opportunity = await dependencies.opportunities.update(
                    context,
                    id,
                    body,
                    parseOpportunityIncludes(url.searchParams),
                );

                return jsonApiResponse(
                    opportunityDocument(opportunity),
                    200,
                    requestId,
                );
            }

            if (request.method === "DELETE") {
                await dependencies.opportunities.delete(context, id);

                return jsonResponse(null, 204, requestId);
            }

            return jsonResponse(
                { message: "Method Not Allowed" },
                405,
                requestId,
            );
        },
    );
