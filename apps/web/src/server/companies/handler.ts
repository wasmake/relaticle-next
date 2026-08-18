import { jsonApiResponse, jsonResponse } from "@/server/api/errors";
import type { ApiAccessResolver } from "@/server/api/http";
import {
    handleAuthenticatedApiRequest,
    parseJsonObject,
} from "@/server/api/http";
import { ulidSchema } from "@/server/ids";

import { parseCompanyIncludes, parseCompanyListQuery } from "./query";
import {
    companyCollectionDocument,
    companyDocument,
} from "./resource";
import type { CompaniesService } from "./service";

export type CompaniesApiDependencies = Readonly<{
    auth: ApiAccessResolver;
    companies: CompaniesService;
}>;

const companyIdFrom = (value: string) => {
    const parsed = ulidSchema.safeParse(value);

    return parsed.success ? parsed.data : undefined;
};

export const handleCompaniesCollectionRequest = (
    request: Request,
    dependencies: CompaniesApiDependencies,
): Promise<Response> =>
    handleAuthenticatedApiRequest(
        request,
        dependencies.auth,
        async ({ context }, requestId) => {
            const url = new URL(request.url);

            if (request.method === "GET") {
                const query = parseCompanyListQuery(url);
                const result = await dependencies.companies.list(context, query);

                return jsonApiResponse(
                    companyCollectionDocument(result, url),
                    200,
                    requestId,
                );
            }

            if (request.method === "POST") {
                const body = await parseJsonObject(request);
                const company = await dependencies.companies.create(
                    context,
                    body,
                    parseCompanyIncludes(url.searchParams),
                );

                return jsonApiResponse(
                    companyDocument(company),
                    201,
                    requestId,
                );
            }

            return jsonResponse({ message: "Method Not Allowed" }, 405, requestId);
        },
    );

export const handleCompanyRequest = (
    request: Request,
    companyId: string,
    dependencies: CompaniesApiDependencies,
): Promise<Response> =>
    handleAuthenticatedApiRequest(
        request,
        dependencies.auth,
        async ({ context }, requestId) => {
            const id = companyIdFrom(companyId);

            if (id === undefined) {
                return jsonResponse({ message: "Not Found" }, 404, requestId);
            }

            const url = new URL(request.url);

            if (request.method === "GET") {
                const company = await dependencies.companies.show(
                    context,
                    id,
                    parseCompanyIncludes(url.searchParams),
                );

                return jsonApiResponse(
                    companyDocument(company),
                    200,
                    requestId,
                );
            }

            if (request.method === "PUT" || request.method === "PATCH") {
                const body = await parseJsonObject(request);
                const company = await dependencies.companies.update(
                    context,
                    id,
                    body,
                    parseCompanyIncludes(url.searchParams),
                );

                return jsonApiResponse(
                    companyDocument(company),
                    200,
                    requestId,
                );
            }

            if (request.method === "DELETE") {
                await dependencies.companies.delete(context, id);

                return jsonResponse(null, 204, requestId);
            }

            return jsonResponse({ message: "Method Not Allowed" }, 405, requestId);
        },
    );
