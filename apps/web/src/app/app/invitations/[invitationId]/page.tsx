import { requireBrowserUser } from "@/server/auth/browser/context";
import { ulidSchema } from "@/server/ids";
import { getInvitation } from "@/server/workspaces/service";

const InvitationPage = async ({ params }: { params: Promise<{ invitationId: string }> }) => {
    const identity = await requireBrowserUser();
    const { invitationId } = await params;
    const id = ulidSchema.parse(invitationId);
    const invitation = await getInvitation(identity.userId, id);
    return <main className="account-page"><section className="account-panel invitation-panel"><p className="eyebrow">Workspace invitation</p><h1>Join {invitation.teamName}</h1><p>You were invited as {invitation.role ?? "member"}.</p><form method="post" action="/auth/team/invitations/accept"><input type="hidden" name="invitation_id" value={invitation.id} /><button type="submit">Accept invitation</button></form></section></main>;
};
export default InvitationPage;
