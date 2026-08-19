import { NextResponse } from "next/server";

import { requireBrowserUser } from "@/server/auth/browser/context";
import { rejectCrossOrigin, textFormValue } from "@/server/auth/browser/request";
import { ulidSchema } from "@/server/ids";
import { acceptInvitation } from "@/server/workspaces/service";
import { accountMailDelivery } from "@/server/accounts/delivery";
import { queueMailcoachEvent } from "@/server/accounts/mailcoach";

export const POST = async (request: Request): Promise<Response> => {
    const rejected = rejectCrossOrigin(request);
    if (rejected !== undefined) return rejected;
    const identity = await requireBrowserUser();
    const invitationId = ulidSchema.safeParse(textFormValue(await request.formData(), "invitation_id"));
    if (!invitationId.success) return new Response("Invalid invitation.", { status: 422 });
    try {
        const invitation = await acceptInvitation(identity.userId, invitationId.data);
        await accountMailDelivery.send({ kind: "member-joined", recipient: invitation.ownerEmail, subjectName: invitation.teamName, url: new URL(`/app/${invitation.slug}/settings/team`, request.url).toString() });
        await queueMailcoachEvent(identity.userId, "team");
        return NextResponse.redirect(new URL(`/app/${invitation.slug}`, request.url), 303);
    } catch {
        return new Response("Invitation unavailable.", { status: 403 });
    }
};
