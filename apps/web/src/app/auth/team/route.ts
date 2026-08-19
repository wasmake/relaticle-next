import { NextResponse } from "next/server";
import { z } from "zod";

import { accountMailDelivery } from "@/server/accounts/delivery";
import { requireBrowserTeam } from "@/server/auth/browser/context";
import { rejectCrossOrigin, textFormValue } from "@/server/auth/browser/request";
import { ulidSchema } from "@/server/ids";
import { changeMemberRole, inviteMember, leaveWorkspace, removeMember, WorkspaceAuthorizationError, WorkspaceValidationError } from "@/server/workspaces/service";

const roleSchema = z.enum(["admin", "member"]);
export const POST = async (request: Request): Promise<Response> => {
    const rejected = rejectCrossOrigin(request);
    if (rejected !== undefined) return rejected;
    const form = await request.formData();
    const slug = textFormValue(form, "team_slug");
    const auth = await requireBrowserTeam(slug);
    const intent = textFormValue(form, "intent");
    try {
        if (intent === "invite") {
            const email = z.email().max(255).parse(textFormValue(form, "email"));
            const role = roleSchema.parse(textFormValue(form, "role"));
            const invitationId = await inviteMember(auth.context.userId, auth.context.teamId, email, role);
            await accountMailDelivery.send({ kind: "team-invitation", recipient: email, url: new URL(`/app/invitations/${invitationId}`, request.url).toString() });
        } else if (intent === "leave") {
            await leaveWorkspace(auth.context.userId, auth.context.teamId);
            return NextResponse.redirect(new URL("/app/new", request.url), 303);
        } else {
            const memberId = ulidSchema.parse(textFormValue(form, "member_id"));
            if (intent === "role") {
                const recipient = await changeMemberRole(auth.context.userId, auth.context.teamId, memberId, roleSchema.parse(textFormValue(form, "role")));
                if (recipient) await accountMailDelivery.send({ kind: "member-role-changed", recipient: recipient.email, subjectName: recipient.teamName, url: new URL(`/app/${slug}`, request.url).toString() });
            } else if (intent === "remove") {
                const recipient = await removeMember(auth.context.userId, auth.context.teamId, memberId);
                if (recipient) await accountMailDelivery.send({ kind: "member-removed", recipient: recipient.email, subjectName: recipient.teamName });
            }
            else return new Response("Invalid action.", { status: 422 });
        }
        return NextResponse.redirect(new URL(`/app/${slug}/settings/team?updated=1`, request.url), 303);
    } catch (error) {
        if (error instanceof WorkspaceAuthorizationError) return new Response("Forbidden.", { status: 403 });
        const code = error instanceof WorkspaceValidationError ? "invalid" : "failed";
        return NextResponse.redirect(new URL(`/app/${slug}/settings/team?error=${code}`, request.url), 303);
    }
};
