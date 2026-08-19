import { NextResponse } from "next/server";

import { revokeSession } from "@/server/accounts/service";
import { requireBrowserUser } from "@/server/auth/browser/context";
import { rejectCrossOrigin, textFormValue } from "@/server/auth/browser/request";

export const POST = async (request: Request): Promise<Response> => {
    const rejected = rejectCrossOrigin(request);
    if (rejected !== undefined) return rejected;
    const identity = await requireBrowserUser();
    const sessionId = textFormValue(await request.formData(), "session_id");
    await revokeSession(identity.userId, sessionId);
    return NextResponse.redirect(new URL("/app/settings/security?sessions=updated", request.url), 303);
};
