"use server";

import { revalidatePath } from "next/cache";

import { requireBrowserTeam } from "@/server/auth/browser/context";
import { createCustomFieldSection, CustomFieldAuthorizationError, CustomFieldInputError, reorderCustomField, saveCustomField, setCustomFieldActive, setCustomFieldSectionActive, updateCustomFieldSection } from "@/server/custom-field-metadata/browser";

export type FieldSettingsState = Readonly<{ status: "idle" | "error" | "success"; message: string }>;
const text = (data: FormData, key: string): string => typeof data.get(key) === "string" ? data.get(key) as string : "";

export const updateFieldSettings = async (teamSlug: string, _state: FieldSettingsState, data: FormData): Promise<FieldSettingsState> => {
    const authentication = await requireBrowserTeam(teamSlug);
    const intent = text(data, "intent");
    try {
        if (intent === "section") {
            const id = text(data, "id");
            const input = { name: text(data, "name"), entityType: text(data, "entity_type") };
            if (id === "") await createCustomFieldSection(authentication.context.userId, authentication.context.teamId, input);
            else await updateCustomFieldSection(authentication.context.userId, authentication.context.teamId, id, input);
        }
        else if (intent === "section-active") await setCustomFieldSectionActive(authentication.context.userId, authentication.context.teamId, text(data, "id"), text(data, "active") === "true");
        else if (intent === "reorder") await reorderCustomField(authentication.context.userId, authentication.context.teamId, text(data, "kind") as "section" | "field" | "option", text(data, "id"), text(data, "direction") === "up" ? -1 : 1);
        else if (intent === "active") await setCustomFieldActive(authentication.context.userId, authentication.context.teamId, text(data, "id"), text(data, "active") === "true");
        else {
            const id = text(data, "id");
            await saveCustomField(authentication.context.userId, authentication.context.teamId, { ...(id === "" ? {} : { id }), name: text(data, "name"), code: text(data, "code"), type: text(data, "type"), entityType: text(data, "entity_type"), sectionId: text(data, "section_id") || null, required: data.get("required") === "true", minimum: text(data, "minimum"), maximum: text(data, "maximum"), options: text(data, "options").split("\n") });
        }
        revalidatePath(`/app/${teamSlug}/settings/custom-fields`);
        return { status: "success", message: "Custom fields saved." };
    } catch (error) {
        if (error instanceof CustomFieldAuthorizationError || error instanceof CustomFieldInputError) return { status: "error", message: error.message };
        console.error("Custom field settings update failed", error);
        return { status: "error", message: "The custom-field change could not be saved." };
    }
};
