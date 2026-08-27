import { requireBrowserTeam } from "@/server/auth/browser/context";
import { ResourcePage } from "@/components/crm/resource-page";
import { WorkspaceShell } from "@/components/crm/workspace-shell";

import { mutateCrmResource } from "./_crm-actions";
import { loadCrmPage, type CrmResource } from "./_crm-data";

type CrmRouteProperties = Readonly<{
    params: Promise<{ teamSlug: string }>;
    searchParams: Promise<{
        page?: string | string[];
        search?: string | string[];
        sort?: string | string[];
    }>;
}>;

const firstValue = (value: string | readonly string[] | undefined): string | undefined =>
    typeof value === "string" ? value : value?.[0];

export const renderCrmResourcePage = async (
    resource: CrmResource,
    { params, searchParams }: CrmRouteProperties,
) => {
    const [{ teamSlug }, query] = await Promise.all([params, searchParams]);
    const authentication = await requireBrowserTeam(teamSlug);
    const pageValue = firstValue(query.page);
    const data = await loadCrmPage(
        authentication.context,
        resource,
        Number(pageValue ?? "1"),
        firstValue(query.search)?.trim() ?? "",
        firstValue(query.sort) ?? "-created_at",
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
