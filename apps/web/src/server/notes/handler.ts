import { jsonApiResponse, jsonResponse } from "@/server/api/errors";
import type { ApiAccessResolver } from "@/server/api/http";
import {
    handleAuthenticatedApiRequest,
    parseJsonObject,
} from "@/server/api/http";
import { ulidSchema } from "@/server/ids";

import { parseNoteIncludes, parseNoteListQuery } from "./query";
import { noteCollectionDocument, noteDocument } from "./resource";
import type { NotesService } from "./service";

export type NotesApiDependencies = Readonly<{
    auth: ApiAccessResolver;
    notes: NotesService;
}>;

const noteIdFrom = (value: string) => {
    const parsed = ulidSchema.safeParse(value);

    return parsed.success ? parsed.data : undefined;
};

export const handleNotesCollectionRequest = (
    request: Request,
    dependencies: NotesApiDependencies,
): Promise<Response> =>
    handleAuthenticatedApiRequest(
        request,
        dependencies.auth,
        async ({ context }, requestId) => {
            const url = new URL(request.url);

            if (request.method === "GET") {
                const query = parseNoteListQuery(url);
                const result = await dependencies.notes.list(context, query);

                return jsonApiResponse(
                    noteCollectionDocument(result, url),
                    200,
                    requestId,
                );
            }

            if (request.method === "POST") {
                const body = await parseJsonObject(request);
                const note = await dependencies.notes.create(
                    context,
                    body,
                    parseNoteIncludes(url.searchParams),
                );

                return jsonApiResponse(noteDocument(note), 201, requestId);
            }

            return jsonResponse(
                { message: "Method Not Allowed" },
                405,
                requestId,
            );
        },
    );

export const handleNoteRequest = (
    request: Request,
    noteId: string,
    dependencies: NotesApiDependencies,
): Promise<Response> =>
    handleAuthenticatedApiRequest(
        request,
        dependencies.auth,
        async ({ context }, requestId) => {
            const id = noteIdFrom(noteId);

            if (id === undefined) {
                return jsonResponse({ message: "Not Found" }, 404, requestId);
            }

            const url = new URL(request.url);

            if (request.method === "GET") {
                const note = await dependencies.notes.show(
                    context,
                    id,
                    parseNoteIncludes(url.searchParams),
                );

                return jsonApiResponse(noteDocument(note), 200, requestId);
            }

            if (request.method === "PUT" || request.method === "PATCH") {
                const body = await parseJsonObject(request);
                const note = await dependencies.notes.update(
                    context,
                    id,
                    body,
                    parseNoteIncludes(url.searchParams),
                );

                return jsonApiResponse(noteDocument(note), 200, requestId);
            }

            if (request.method === "DELETE") {
                await dependencies.notes.delete(context, id);

                return jsonResponse(null, 204, requestId);
            }

            return jsonResponse(
                { message: "Method Not Allowed" },
                405,
                requestId,
            );
        },
    );
