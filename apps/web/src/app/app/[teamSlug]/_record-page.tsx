import { notFound } from "next/navigation";

import { RecordDetailPage } from "@/components/crm/record-detail";
import { WorkspaceShell } from "@/components/crm/workspace-shell";
import { requireBrowserTeam } from "@/server/auth/browser/context";
import { ApiNotFoundError } from "@/server/api/errors";
import { ulidSchema } from "@/server/ids";

import { mutateCrmResource } from "./_crm-actions";
import { loadCrmPage, type CrmResource } from "./_crm-data";
import { loadCrmRecordDetail } from "./_record-data";

export const renderCrmRecordPage = async (resource: CrmResource, properties: { params: Promise<{ teamSlug: string; recordId: string }> }) => {
    const { teamSlug, recordId } = await properties.params;
    const id = ulidSchema.safeParse(recordId);
    if (!id.success) notFound();
    const authentication = await requireBrowserTeam(teamSlug);
    try {
        const [record, options] = await Promise.all([loadCrmRecordDetail(authentication.context, resource, id.data), loadCrmPage(authentication.context, resource, 1)]);
        return <WorkspaceShell teamSlug={teamSlug} teamName={authentication.team.name} active={resource}><RecordDetailPage action={mutateCrmResource.bind(null, teamSlug, resource)} activity={record.activity} companies={options.companies} customFields={record.customFields} detail={record.detail} people={options.people} resource={resource} teamSlug={teamSlug} /></WorkspaceShell>;
    } catch (error) {
        if (error instanceof ApiNotFoundError) notFound();
        throw error;
    }
};
