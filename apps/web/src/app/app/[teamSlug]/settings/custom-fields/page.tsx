import { CustomFieldManager } from "@/components/crm/custom-field-manager";
import { WorkspaceShell } from "@/components/crm/workspace-shell";
import styles from "@/components/crm/crm.module.css";
import { requireBrowserTeam } from "@/server/auth/browser/context";
import { canManageWorkspace, listCustomFieldConfiguration } from "@/server/custom-field-metadata/browser";

import { updateFieldSettings } from "./actions";

const rules = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
const CustomFieldsPage = async ({ params }: { params: Promise<{ teamSlug: string }> }) => {
    const { teamSlug } = await params;
    const authentication = await requireBrowserTeam(teamSlug);
    const [configuration, canManage] = await Promise.all([listCustomFieldConfiguration(authentication.context.teamId), canManageWorkspace(authentication.context.userId, authentication.context.teamId)]);
    const sections = configuration.sections.map((section) => ({ id: section.id, name: section.name, entityType: section.entityType, active: section.active, systemDefined: section.systemDefined }));
    const fields = configuration.fields.map((field) => { const validation = rules(field.validationRules); return { id: field.id, sectionId: field.customFieldSectionId, name: field.name, code: field.code, type: field.type, entityType: field.entityType, active: field.active, systemDefined: field.systemDefined, required: validation.required === true, minimum: String(validation.min_value ?? validation.min_length ?? ""), maximum: String(validation.max_value ?? validation.max_length ?? ""), options: configuration.options.filter((option) => option.customFieldId === field.id).map((option) => option.name ?? "") }; });
    return <WorkspaceShell teamSlug={teamSlug} teamName={authentication.team.name} active="settings"><header className={styles.header}><div><h1>Custom Fields</h1><p>Manage fields for all record types.</p></div></header><CustomFieldManager action={updateFieldSettings.bind(null, teamSlug)} canManage={canManage} fields={fields} sections={sections} /></WorkspaceShell>;
};
export default CustomFieldsPage;
