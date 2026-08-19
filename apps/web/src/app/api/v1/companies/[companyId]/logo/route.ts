import { z } from "zod";

import { ApiBadRequestError, ApiValidationError, jsonResponse } from "@/server/api/errors";
import { handleAuthenticatedApiRequest } from "@/server/api/http";
import { ulidSchema } from "@/server/ids";
import { parseBoundedFormData, parseBoundedJsonObject } from "@/server/http/body";
import { mediaApiDependencies } from "@/server/media/production";
import { fetchRemoteImage } from "@/server/media/remote-image";
import { MediaValidationError } from "@/server/media/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = Readonly<{ params: Promise<{ companyId: string }> }>;

export const POST = async (request: Request, routeContext: Context): Promise<Response> => {
    const { companyId } = await routeContext.params;
    return handleAuthenticatedApiRequest(request, mediaApiDependencies.auth, async ({ context }, requestId) => {
        const parsedId = ulidSchema.safeParse(companyId);
        if (!parsedId.success) return jsonResponse({ message: "Not Found" }, 404, requestId);
        try {
            let file: { bytes: Uint8Array; mimeType: string; fileName: string };
            if (request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
                const form = await parseBoundedFormData(request, 6 * 1024 * 1024);
                const upload = form.get("file");
                if (!(upload instanceof File)) throw new ApiBadRequestError("An image file is required.");
                file = { bytes: new Uint8Array(await upload.arrayBuffer()), mimeType: upload.type, fileName: upload.name };
            } else {
                const body: unknown = await parseBoundedJsonObject(request, 16 * 1024);
                const parsed = z.object({ url: z.url().optional(), website_url: z.url().optional() }).refine((value) => value.url !== undefined || value.website_url !== undefined).safeParse(body);
                if (!parsed.success) throw new ApiValidationError([{ path: "url", message: "A favicon URL or website URL is required." }]);
                const remoteUrl = parsed.data.url ?? new URL("/favicon.ico", parsed.data.website_url).toString();
                file = await fetchRemoteImage(remoteUrl);
            }
            const media = await mediaApiDependencies.media.upload(context, { modelType: "company", modelId: parsedId.data, collectionName: "logo", ...file, imagesOnly: true }, true);
            return jsonResponse({ data: { id: media.uuid, type: "media", attributes: { file_name: media.fileName, mime_type: media.mimeType, size: Number(media.size), download_url: `/api/v1/media/${media.uuid}` } } }, 201, requestId);
        } catch (error) {
            if (error instanceof MediaValidationError) throw new ApiValidationError([{ path: error.path, message: error.message }]);
            throw error;
        }
    });
};
