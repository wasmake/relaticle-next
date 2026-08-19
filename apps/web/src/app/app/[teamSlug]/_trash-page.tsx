import { TrashPage } from "@/components/crm/trash-page";
import { WorkspaceShell } from "@/components/crm/workspace-shell";
import { requireBrowserTeam } from "@/server/auth/browser/context";
import { listTrash } from "@/server/browser-crm/service";

import { mutateCrmResource } from "./_crm-actions";
import type { CrmResource } from "./_crm-data";

export const renderCrmTrashPage = async (resource: CrmResource, properties: { params: Promise<{ teamSlug: string }> }) => {
    const { teamSlug } = await properties.params;
    const authentication = await requireBrowserTeam(teamSlug);
    const records = await listTrash(authentication.context.teamId, resource);
    return <WorkspaceShell teamSlug={teamSlug} teamName={authentication.team.name} active={resource}><TrashPage action={mutateCrmResource.bind(null, teamSlug, resource)} records={records} resource={resource} teamSlug={teamSlug} /></WorkspaceShell>;
};
