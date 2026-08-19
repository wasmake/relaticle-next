import { CrmBoard } from "@/components/crm/board";
import { WorkspaceShell } from "@/components/crm/workspace-shell";
import { requireBrowserTeam } from "@/server/auth/browser/context";

import { moveBoardCard } from "./_crm-actions";
import { loadBoardData } from "./_board-data";

export const renderBoardPage = async (resource: "opportunities" | "tasks", properties: { params: Promise<{ teamSlug: string }> }) => {
    const { teamSlug } = await properties.params;
    const authentication = await requireBrowserTeam(teamSlug);
    const data = await loadBoardData(authentication.context, resource);
    return <WorkspaceShell teamSlug={teamSlug} teamName={authentication.team.name} active={resource}><CrmBoard action={moveBoardCard.bind(null, teamSlug, resource)} initial={data} teamSlug={teamSlug} /></WorkspaceShell>;
};
