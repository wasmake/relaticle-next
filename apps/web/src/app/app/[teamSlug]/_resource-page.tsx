import { requireBrowserTeam } from "@/server/auth/browser/context";
import { ResourcePage } from "@/components/crm/resource-page";
import { WorkspaceShell } from "@/components/crm/workspace-shell";

import { mutateCrmResource } from "./_crm-actions";
import { loadCrmPage, type CrmResource } from "./_crm-data";

type CrmRouteProperties = Readonly<{
    params: Promise<{ teamSlug: string }>;
    searchParams: Promise<{ page?: string | string[] }>;
}>;

export const renderCrmResourcePage = async (
    resource: CrmResource,
    { params, searchParams }: CrmRouteProperties,
) => {
    const [{ teamSlug }, query] = await Promise.all([params, searchParams]);
    const authentication = await requireBrowserTeam(teamSlug);
    const pageValue = Array.isArray(query.page) ? query.page[0] : query.page;
    const data = await loadCrmPage(
        authentication.context,
        resource,
        Number(pageValue ?? "1"),
    );
    const action = mutateCrmResource.bind(null, teamSlug, resource);

    return (
        <WorkspaceShell
            teamSlug={teamSlug}
            teamName={authentication.team.name}
            active={resource}
        >
            <ResourcePage action={action} data={data} teamSlug={teamSlug} />
        </WorkspaceShell>
    );
};

export type { CrmRouteProperties };
