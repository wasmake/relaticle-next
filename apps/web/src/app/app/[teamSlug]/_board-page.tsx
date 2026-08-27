import { CrmBoard } from "@/components/crm/board";
import { WorkspaceShell } from "@/components/crm/workspace-shell";
import { requireBrowserTeam } from "@/server/auth/browser/context";

import { moveBoardCard, mutateCrmResource } from "./_crm-actions";
import { loadBoardData } from "./_board-data";
import { loadCrmPage } from "./_crm-data";

export const renderBoardPage = async (resource: "opportunities" | "tasks", properties: { params: Promise<{ teamSlug: string }> }) => {
    const { teamSlug } = await properties.params;
    const authentication = await requireBrowserTeam(teamSlug);
    const [data, createData] = await Promise.all([loadBoardData(authentication.context, resource), loadCrmPage(authentication.context, resource, 1)]);
    return <WorkspaceShell teamSlug={teamSlug} teamName={authentication.team.name} active={resource}><CrmBoard action={moveBoardCard.bind(null, teamSlug, resource)} createAction={mutateCrmResource.bind(null, teamSlug, resource)} createData={{ companies: createData.companies, customFields: createData.customFields, fieldLabel: createData.fieldLabel, people: createData.people, resource: createData.resource }} initial={data} teamSlug={teamSlug} /></WorkspaceShell>;
};
