import { z } from "zod";

import { ApiBadRequestError, ApiValidationError, jsonResponse } from "@/server/api/errors";
import type { ApiAccessResolver } from "@/server/api/http";
import { handleAuthenticatedApiRequest } from "@/server/api/http";
import { ulidSchema } from "@/server/ids";
import { parseBoundedFormData } from "@/server/http/body";

import type { MediaService } from "./service";
import { mediaModelTypes, MediaValidationError } from "./types";
import { MAX_MEDIA_BYTES } from "./validation";

export type MediaApiDependencies = Readonly<{ auth: ApiAccessResolver; media: MediaService }>;
const uploadSchema = z.object({ modelType: z.enum(mediaModelTypes), modelId: ulidSchema, collectionName: z.string() });

const validationError = (error: unknown): never => {
    if (error instanceof MediaValidationError) throw new ApiValidationError([{ path: error.path, message: error.message }]);
    throw error;
};

export const handleMediaCollectionRequest = (request: Request, dependencies: MediaApiDependencies): Promise<Response> =>
    handleAuthenticatedApiRequest(request, dependencies.auth, async ({ context }, requestId) => {
        if (request.method !== "POST") return jsonResponse({ message: "Method Not Allowed" }, 405, requestId);
        const contentLength = Number(request.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > MAX_MEDIA_BYTES + 1024 * 1024) throw new ApiBadRequestError("The multipart request is too large.");
        if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) throw new ApiBadRequestError("A multipart/form-data request is required.");
        const form = await parseBoundedFormData(request, MAX_MEDIA_BYTES + 1024 * 1024);
        const file = form.get("file");
        const parsed = uploadSchema.safeParse({ modelType: form.get("model_type"), modelId: form.get("model_id"), collectionName: form.get("collection_name") });
        if (!parsed.success || !(file instanceof File)) throw new ApiValidationError([{ path: "file", message: "A file and valid model attachment are required." }]);
        try {
            const record = await dependencies.media.upload(context, {
                ...parsed.data, fileName: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()),
                imagesOnly: form.get("images_only") === "true",
            }, form.get("replace_collection") === "true");
            return jsonResponse({ data: mediaResource(record) }, 201, requestId);
        } catch (error) {
            return validationError(error);
        }
    });

export const handleMediaRequest = (request: Request, uuid: string, dependencies: MediaApiDependencies): Promise<Response> =>
    handleAuthenticatedApiRequest(request, dependencies.auth, async ({ context }, requestId) => {
        if (!z.uuid().safeParse(uuid).success) return jsonResponse({ message: "Not Found" }, 404, requestId);
        if (request.method === "DELETE") {
            await dependencies.media.remove(context, uuid);
            return jsonResponse(null, 204, requestId);
        }
        if (request.method !== "GET") return jsonResponse({ message: "Method Not Allowed" }, 405, requestId);
        const { record, bytes } = await dependencies.media.download(context, uuid);
        return new Response(bytes.slice().buffer as ArrayBuffer, { status: 200, headers: {
            "cache-control": "private, no-store", "content-type": record.mimeType, "content-length": record.size.toString(),
            "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(record.fileName)}`, "x-content-type-options": "nosniff", "x-request-id": requestId,
        } });
    });

const mediaResource = (record: Awaited<ReturnType<MediaService["upload"]>>) => ({
    id: record.uuid, type: "media", attributes: { model_type: record.modelType, model_id: record.modelId, collection_name: record.collectionName, name: record.name, file_name: record.fileName, mime_type: record.mimeType, size: Number(record.size), download_url: `/api/v1/media/${record.uuid}` },
});
