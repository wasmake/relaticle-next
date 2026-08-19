import { NextResponse } from "next/server";
import { z } from "zod";

import { requireBrowserUser } from "@/server/auth/browser/context";
import { rejectCrossOrigin, textFormValue } from "@/server/auth/browser/request";
import { createWorkspace, WorkspaceValidationError } from "@/server/workspaces/service";
import { queueMailcoachEvent } from "@/server/accounts/mailcoach";

export const POST = async (request: Request): Promise<Response> => {
    const rejected = rejectCrossOrigin(request);
    if (rejected !== undefined) return rejected;
    const identity = await requireBrowserUser();
    const form = await request.formData();
    const name = z.string().trim().min(2).max(255).safeParse(textFormValue(form, "name"));
    if (!name.success) return NextResponse.redirect(new URL("/app/new?error=invalid", request.url), 303);
    try {
        const workspace = await createWorkspace(identity.userId, {
            name: name.data,
            useCase: textFormValue(form, "use_case").slice(0, 255),
            referralSource: textFormValue(form, "referral_source").slice(0, 255),
        });
        await queueMailcoachEvent(identity.userId, "team");
        return NextResponse.redirect(new URL(`/app/${workspace.slug}`, request.url), 303);
    } catch (error) {
        const code = error instanceof WorkspaceValidationError ? "invalid" : "failed";
        return NextResponse.redirect(new URL(`/app/new?error=${code}`, request.url), 303);
    }
};
