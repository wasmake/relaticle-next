import { jsonApiResponse, jsonResponse } from "@/server/api/errors";
import type { ApiAccessResolver } from "@/server/api/http";
import {
    handleAuthenticatedApiRequest,
    parseJsonObject,
} from "@/server/api/http";
import { ulidSchema } from "@/server/ids";

import { parsePeopleListQuery, parsePeopleResourceQuery } from "./query";
import { peopleCollectionDocument, peopleDocument } from "./resource";
import type { PeopleService } from "./service";

export type PeopleApiDependencies = Readonly<{
    auth: ApiAccessResolver;
    people: PeopleService;
}>;

const personIdFrom = (value: string) => {
    const parsed = ulidSchema.safeParse(value);

    return parsed.success ? parsed.data : undefined;
};

export const handlePeopleCollectionRequest = (
    request: Request,
    dependencies: PeopleApiDependencies,
): Promise<Response> =>
    handleAuthenticatedApiRequest(
        request,
        dependencies.auth,
        async ({ context }, requestId) => {
            const url = new URL(request.url);

            if (request.method === "GET") {
                const query = parsePeopleListQuery(url);
                const result = await dependencies.people.list(context, query);

                return jsonApiResponse(
                    peopleCollectionDocument(result, url),
                    200,
                    requestId,
                );
            }

            if (request.method === "POST") {
                const body = await parseJsonObject(request);
                const query = parsePeopleResourceQuery(url.searchParams);
                const person = await dependencies.people.create(
                    context,
                    body,
                    query.includes,
                    query.fields,
                );

                return jsonApiResponse(peopleDocument(person), 201, requestId);
            }

            return jsonResponse(
                { message: "Method Not Allowed" },
                405,
                requestId,
            );
        },
    );

export const handlePersonRequest = (
    request: Request,
    personId: string,
    dependencies: PeopleApiDependencies,
): Promise<Response> =>
    handleAuthenticatedApiRequest(
        request,
        dependencies.auth,
        async ({ context }, requestId) => {
            const id = personIdFrom(personId);

            if (id === undefined) {
                return jsonResponse({ message: "Not Found" }, 404, requestId);
            }

            const url = new URL(request.url);

            if (request.method === "GET") {
                const query = parsePeopleResourceQuery(url.searchParams);
                const person = await dependencies.people.show(
                    context,
                    id,
                    query.includes,
                    query.fields,
                );

                return jsonApiResponse(peopleDocument(person), 200, requestId);
            }

            if (request.method === "PUT" || request.method === "PATCH") {
                const body = await parseJsonObject(request);
                const query = parsePeopleResourceQuery(url.searchParams);
                const person = await dependencies.people.update(
                    context,
                    id,
                    body,
                    query.includes,
                    query.fields,
                );

                return jsonApiResponse(peopleDocument(person), 200, requestId);
            }

            if (request.method === "DELETE") {
                await dependencies.people.delete(context, id);

                return jsonResponse(null, 204, requestId);
            }

            return jsonResponse(
                { message: "Method Not Allowed" },
                405,
                requestId,
            );
        },
    );
