import { NextResponse } from "next/server";

import { requireBrowserUser } from "@/server/auth/browser/context";
import { rejectCrossOrigin, textFormValue } from "@/server/auth/browser/request";
import { ulidSchema } from "@/server/ids";
import { switchWorkspace } from "@/server/workspaces/service";

export const POST = async (request: Request): Promise<Response> => {
    const rejected = rejectCrossOrigin(request);
    if (rejected !== undefined) return rejected;
    const identity = await requireBrowserUser();
    const teamId = ulidSchema.safeParse(textFormValue(await request.formData(), "team_id"));
    if (!teamId.success) return new Response("Invalid workspace.", { status: 422 });
    try {
        const slug = await switchWorkspace(identity.userId, teamId.data);
        return NextResponse.redirect(new URL(`/app/${slug}`, request.url), 303);
    } catch {
        return new Response("Forbidden.", { status: 403 });
    }
};
