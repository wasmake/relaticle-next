import { jsonApiResponse, jsonResponse } from "@/server/api/errors";
import type { ApiAccessResolver } from "@/server/api/http";
import {
    handleAuthenticatedApiRequest,
    parseJsonObject,
} from "@/server/api/http";
import { ulidSchema } from "@/server/ids";

import { parseTaskIncludes, parseTaskListQuery } from "./query";
import { taskCollectionDocument, taskDocument } from "./resource";
import type { TasksService } from "./service";

export type TasksApiDependencies = Readonly<{
    auth: ApiAccessResolver;
    tasks: TasksService;
}>;

const taskIdFrom = (value: string) => {
    const parsed = ulidSchema.safeParse(value);

    return parsed.success ? parsed.data : undefined;
};

export const handleTasksCollectionRequest = (
    request: Request,
    dependencies: TasksApiDependencies,
): Promise<Response> =>
    handleAuthenticatedApiRequest(
        request,
        dependencies.auth,
        async ({ context }, requestId) => {
            const url = new URL(request.url);

            if (request.method === "GET") {
                const query = parseTaskListQuery(url);
                const result = await dependencies.tasks.list(context, query);

                return jsonApiResponse(
                    taskCollectionDocument(result, url),
                    200,
                    requestId,
                );
            }

            if (request.method === "POST") {
                const body = await parseJsonObject(request);
                const task = await dependencies.tasks.create(
                    context,
                    body,
                    parseTaskIncludes(url.searchParams),
                );

                return jsonApiResponse(taskDocument(task), 201, requestId);
            }

            return jsonResponse(
                { message: "Method Not Allowed" },
                405,
                requestId,
            );
        },
    );

export const handleTaskRequest = (
    request: Request,
    taskId: string,
    dependencies: TasksApiDependencies,
): Promise<Response> =>
    handleAuthenticatedApiRequest(
        request,
        dependencies.auth,
        async ({ context }, requestId) => {
            const id = taskIdFrom(taskId);

            if (id === undefined) {
                return jsonResponse({ message: "Not Found" }, 404, requestId);
            }

            const url = new URL(request.url);

            if (request.method === "GET") {
                const task = await dependencies.tasks.show(
                    context,
                    id,
                    parseTaskIncludes(url.searchParams),
                );

                return jsonApiResponse(taskDocument(task), 200, requestId);
            }

            if (request.method === "PUT" || request.method === "PATCH") {
                const body = await parseJsonObject(request);
                const task = await dependencies.tasks.update(
                    context,
                    id,
                    body,
                    parseTaskIncludes(url.searchParams),
                );

                return jsonApiResponse(taskDocument(task), 200, requestId);
            }

            if (request.method === "DELETE") {
                await dependencies.tasks.delete(context, id);

                return jsonResponse(null, 204, requestId);
            }

            return jsonResponse(
                { message: "Method Not Allowed" },
                405,
                requestId,
            );
        },
    );
