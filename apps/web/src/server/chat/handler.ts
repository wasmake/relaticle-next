import { randomUUID } from "node:crypto";

import { jsonResponse } from "@/server/api/errors";
import type { ApiAccessResolver } from "@/server/api/http";
import { handleAuthenticatedApiRequest, parseJsonObject } from "@/server/api/http";

import type { ModelRegistry } from "./model-registry";
import type { ChatService } from "./service";
import { identityFromContext } from "./tools";
import { chatProcessJobName, jobOptionsFor, type ChatProcessJob } from "@queue/jobs";

export type ChatQueue = Readonly<{
    add(name: typeof chatProcessJobName, data: ChatProcessJob, options: ReturnType<typeof jobOptionsFor>): Promise<unknown>;
}>;

export type ChatApiDependencies = Readonly<{
    auth: ApiAccessResolver;
    chat: ChatService;
    models: ModelRegistry;
    queue?: ChatQueue;
}>;
const string = (value: unknown, fallback = ""): string => typeof value === "string" ? value : fallback;
const nullableString = (value: unknown): string | null => typeof value === "string" && value.trim() !== "" ? value.trim() : null;

export const enqueueChatTurn = async (
    queue: ChatQueue,
    input: Omit<ChatProcessJob, "version" | "turnId">,
    turnId = randomUUID(),
): Promise<string> => {
    const job = { version: 1 as const, turnId, ...input };
    await queue.add(chatProcessJobName, job, jobOptionsFor(chatProcessJobName, turnId));
    return turnId;
};

const streamResponse = (events: AsyncIterable<unknown>): Response => {
    const encoder = new TextEncoder();
    return new Response(new ReadableStream<Uint8Array>({
        async start(controller) {
            try {
                for await (const event of events) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
            } catch (error) {
                controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", code: "stream_failed", message: error instanceof Error ? error.message : "Stream failed." })}\n`));
            } finally {
                controller.close();
            }
        },
    }), { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
};

export const handleConversations = (request: Request, dependencies: ChatApiDependencies): Promise<Response> => handleAuthenticatedApiRequest(request, dependencies.auth, async ({ context }, requestId) => {
    const identity = identityFromContext(context);
    if (request.method === "GET") {
        const search = new URL(request.url).searchParams.get("q") ?? undefined;
        return jsonResponse({ conversations: await dependencies.chat.listConversations(identity, search), models: [{ id: "auto", label: "Auto" }, ...dependencies.models.all().map(({ id, label }) => ({ id, label }))] }, 200, requestId);
    }
    if (request.method === "POST") {
        const body = await parseJsonObject(request);
        const conversation = await dependencies.chat.createConversation(identity, string(body.message));
        return jsonResponse({ conversation }, 201, requestId);
    }
    return jsonResponse({ message: "Method Not Allowed" }, 405, requestId);
});

export const handleConversation = (request: Request, conversationId: string, dependencies: ChatApiDependencies): Promise<Response> => handleAuthenticatedApiRequest(request, dependencies.auth, async ({ context }, requestId) => {
    const identity = identityFromContext(context);
    if (request.method === "GET") {
        const result = await dependencies.chat.conversation(identity, conversationId);
        return result === undefined ? jsonResponse({ message: "Not Found" }, 404, requestId) : jsonResponse(result, 200, requestId);
    }
    if (request.method === "PATCH") {
        const body = await parseJsonObject(request);
        return await dependencies.chat.renameConversation(identity, conversationId, string(body.title)) ? jsonResponse({ updated: true }, 200, requestId) : jsonResponse({ message: "Not Found" }, 404, requestId);
    }
    if (request.method === "DELETE") return await dependencies.chat.deleteConversation(identity, conversationId) ? jsonResponse(null, 204, requestId) : jsonResponse({ message: "Not Found" }, 404, requestId);
    return jsonResponse({ message: "Method Not Allowed" }, 405, requestId);
});

export const handleMessages = (request: Request, conversationId: string, dependencies: ChatApiDependencies): Promise<Response> => handleAuthenticatedApiRequest(request, dependencies.auth, async ({ context }, requestId) => {
    const identity = identityFromContext(context);
    if (request.method === "GET") {
        const result = await dependencies.chat.conversation(identity, conversationId);
        return result === undefined ? jsonResponse({ message: "Not Found" }, 404, requestId) : jsonResponse({ messages: result.messages }, 200, requestId);
    }
    if (request.method === "POST") {
        const body = await parseJsonObject(request);
        const mentions = Array.isArray(body.mentions) ? body.mentions.filter((item): item is { type: string; id: string } => typeof item === "object" && item !== null && typeof (item as Record<string, unknown>).type === "string" && typeof (item as Record<string, unknown>).id === "string") : [];
        const pageContext = typeof body.page_context === "object" && body.page_context !== null && typeof (body.page_context as Record<string, unknown>).type === "string" && typeof (body.page_context as Record<string, unknown>).id === "string" ? body.page_context as { type: string; id: string } : null;
        const selectedModel = nullableString(body.model);
        if (dependencies.queue !== undefined) {
            const turnId = await enqueueChatTurn(dependencies.queue, {
                teamId: identity.teamId,
                userId: identity.userId,
                conversationId,
                message: string(body.message),
                ...(body.document === undefined ? {} : { document: body.document }),
                ...(selectedModel === null ? {} : { model: selectedModel }),
                mentions,
                pageContext,
            });
            return streamResponse((async function* () { yield { type: "queued", turnId }; })());
        }
        return streamResponse(dependencies.chat.send(identity, { conversationId, message: string(body.message), document: body.document, ...(selectedModel === null ? {} : { model: selectedModel }), mentions, pageContext }));
    }
    return jsonResponse({ message: "Method Not Allowed" }, 405, requestId);
});

export const handleCancel = (request: Request, conversationId: string, dependencies: ChatApiDependencies): Promise<Response> => handleAuthenticatedApiRequest(request, dependencies.auth, async ({ context }, requestId) => jsonResponse({ cancelled: await dependencies.chat.cancel(identityFromContext(context), conversationId) }, 200, requestId));

export const handleMentions = (request: Request, dependencies: ChatApiDependencies): Promise<Response> => handleAuthenticatedApiRequest(request, dependencies.auth, async ({ context }, requestId) => jsonResponse({ mentions: await dependencies.chat.mentions(identityFromContext(context), new URL(request.url).searchParams.get("q") ?? "") }, 200, requestId));

export const handleAction = (request: Request, actionId: string, decision: "approve" | "reject", dependencies: ChatApiDependencies): Promise<Response> => handleAuthenticatedApiRequest(request, dependencies.auth, async ({ context }, requestId) => {
    const action = await dependencies.chat.resolveAction(identityFromContext(context), actionId, decision);
    return action === undefined ? jsonResponse({ message: "Action is unavailable or expired." }, 409, requestId) : jsonResponse({ action }, 200, requestId);
});

export const handleFeedback = (request: Request, messageId: string, dependencies: ChatApiDependencies): Promise<Response> => handleAuthenticatedApiRequest(request, dependencies.auth, async ({ context }, requestId) => {
    const identity = identityFromContext(context);
    if (request.method === "DELETE") { await dependencies.chat.deleteFeedback(identity, messageId); return jsonResponse(null, 204, requestId); }
    const body = await parseJsonObject(request);
    if (body.rating !== "up" && body.rating !== "down") return jsonResponse({ message: "rating must be up or down." }, 422, requestId);
    await dependencies.chat.feedback(identity, messageId, body.rating, nullableString(body.category), nullableString(body.comment));
    return jsonResponse({ saved: true }, 200, requestId);
});
