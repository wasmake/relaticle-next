import { NextResponse } from "next/server";
import { z } from "zod";

import { AccountValidationError, profilePhotoPath, updateProfile, updateProfilePhotoPath } from "@/server/accounts/service";
import { requireBrowserUser } from "@/server/auth/browser/context";
import { rejectCrossOrigin, textFormValue } from "@/server/auth/browser/request";
import { productionMediaService } from "@/server/media/production";
import type { RequestContext } from "@/server/context/request-context";

const schema = z.object({ name: z.string().trim().min(2).max(255), email: z.email().max(255) });
export const POST = async (request: Request): Promise<Response> => {
    const rejected = rejectCrossOrigin(request);
    if (rejected !== undefined) return rejected;
    const identity = await requireBrowserUser();
    const form = await request.formData();
    const context: RequestContext = { requestId: crypto.randomUUID(), userId: identity.userId, teamId: z.string().length(26).safeParse(identity.currentTeamId).success ? identity.currentTeamId as RequestContext["teamId"] : identity.userId, credential: { kind: "session", sessionId: "profile" } };
    const input = schema.safeParse({ name: textFormValue(form, "name"), email: textFormValue(form, "email") });
    if (!input.success) return NextResponse.redirect(new URL("/app/settings/profile?error=invalid", request.url), 303);
    try {
        await updateProfile(identity.userId, input.data);
        const photo = form.get("photo");
        if (photo instanceof File && photo.size > 0) {
            const media = await productionMediaService.upload(context, { modelType: "user", modelId: identity.userId, collectionName: "profile_photo", fileName: photo.name, mimeType: photo.type, bytes: new Uint8Array(await photo.arrayBuffer()), imagesOnly: true }, true);
            await updateProfilePhotoPath(identity.userId, media.uuid);
        } else if (textFormValue(form, "remove_photo") === "true") {
            const current = await profilePhotoPath(identity.userId);
            if (current !== null) await productionMediaService.remove(context, current);
            await updateProfilePhotoPath(identity.userId, null);
        }
        return NextResponse.redirect(new URL("/app/settings/profile?updated=1", request.url), 303);
    } catch (error) {
        const code = error instanceof AccountValidationError ? "exists" : "failed";
        return NextResponse.redirect(new URL(`/app/settings/profile?error=${code}`, request.url), 303);
    }
};
