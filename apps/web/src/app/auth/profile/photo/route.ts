import { profilePhotoPath } from "@/server/accounts/service";
import { requireBrowserUser } from "@/server/auth/browser/context";
import type { RequestContext } from "@/server/context/request-context";
import { productionMediaService } from "@/server/media/production";

export const runtime = "nodejs";
export const GET = async (): Promise<Response> => {
    const identity = await requireBrowserUser();
    const uuid = await profilePhotoPath(identity.userId);
    if (uuid === null) return new Response("Not Found", { status: 404 });
    const context: RequestContext = { requestId: crypto.randomUUID(), userId: identity.userId, teamId: identity.userId, credential: { kind: "session", sessionId: "profile-photo" } };
    const { record, bytes } = await productionMediaService.download(context, uuid);
    return new Response(bytes.slice().buffer as ArrayBuffer, { headers: { "content-type": record.mimeType, "cache-control": "private, max-age=300", "x-content-type-options": "nosniff" } });
};
