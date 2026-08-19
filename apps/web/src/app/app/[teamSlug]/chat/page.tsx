import { ChatWorkspace } from "@/components/chat/chat-workspace";
import { WorkspaceShell } from "@/components/crm/workspace-shell";
import { requireBrowserTeam } from "@/server/auth/browser/context";
import { chatModels, chatService } from "@/server/chat/production";

const ChatPage = async ({ params }: Readonly<{ params: Promise<{ teamSlug: string }> }>) => {
    const { teamSlug } = await params;
    const authentication = await requireBrowserTeam(teamSlug);
    const conversations = await chatService.listConversations(authentication.context);
    return <WorkspaceShell teamSlug={teamSlug} teamName={authentication.team.name} active="chat">
        <ChatWorkspace teamId={authentication.context.teamId} initialConversations={conversations} models={[{ id: "auto", label: "Auto" }, ...chatModels.all().map(({ id, label }) => ({ id, label }))]} />
    </WorkspaceShell>;
};

export default ChatPage;
