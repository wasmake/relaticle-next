"use server";

import { revalidatePath } from "next/cache";

import { requireBrowserTeam } from "@/server/auth/browser/context";
import { companiesApiDependencies } from "@/server/companies/production";
import { ApiValidationError } from "@/server/api/errors";
import { ulidSchema } from "@/server/ids";
import { notesApiDependencies } from "@/server/notes/production";
import { opportunitiesApiDependencies } from "@/server/opportunities/production";
import { peopleApiDependencies } from "@/server/people/production";
import { tasksApiDependencies } from "@/server/tasks/production";
import { restoreRecord, updateBoardOrder } from "@/server/browser-crm/service";
import type { Ulid } from "@/server/ids";
import { customFieldsFromFormData } from "@/server/custom-fields/browser-form";
import { productionMediaService } from "@/server/media/production";
import type { MediaModelType } from "@/server/media/types";

import type { CrmMutationState, CrmResource } from "./_crm-data";

const textValue = (formData: FormData, name: string): string => {
    const value = formData.get(name);

    return typeof value === "string" ? value : "";
};

const optionalId = (formData: FormData, name: string): string | null => {
    const value = textValue(formData, name);

    return value === "" ? null : value;
};

const ids = (formData: FormData, name: string): string[] =>
    formData.getAll(name).filter((value): value is string => typeof value === "string" && value !== "");

const mediaModelFor = (resource: CrmResource): MediaModelType =>
    resource === "companies" ? "company" : resource === "opportunities" ? "opportunity" : resource === "tasks" ? "task" : resource === "notes" ? "note" : "people";

const uploadCustomFiles = async (context: Awaited<ReturnType<typeof requireBrowserTeam>>["context"], formData: FormData, modelType: MediaModelType, modelId: Ulid): Promise<Readonly<{ uploaded: readonly string[]; replaced: readonly string[] }>> => {
    const uploaded: string[] = [];
    const replaced: string[] = [];
    try {
        for (const [name, value] of formData.entries()) {
            if (!name.startsWith("custom_file.") || !(value instanceof File) || value.size === 0) continue;
            const code = name.slice("custom_file.".length);
            const previous = formData.get(`custom_field.${code}`);
            const record = await productionMediaService.upload(context, {
                modelType, modelId, collectionName: `custom_field_${code}`.slice(0, 64), fileName: value.name,
                mimeType: value.type, bytes: new Uint8Array(await value.arrayBuffer()),
            });
            formData.set(`custom_field.${code}`, record.uuid);
            uploaded.push(record.uuid);
            if (typeof previous === "string" && previous !== "") replaced.push(previous);
        }
        return { uploaded, replaced };
    } catch (error) {
        await Promise.all(uploaded.map((uuid) => productionMediaService.remove(context, uuid).catch(() => undefined)));
        throw error;
    }
};

export const mutateCrmResource = async (
    teamSlug: string,
    resource: CrmResource,
    _previousState: CrmMutationState,
    formData: FormData,
): Promise<CrmMutationState> => {
    const authentication = await requireBrowserTeam(teamSlug);
    const intent = textValue(formData, "intent");

    try {
        if (intent === "restore") {
            const parsedId = ulidSchema.safeParse(textValue(formData, "id"));
            if (!parsedId.success || !await restoreRecord(authentication.context, resource, parsedId.data)) return { status: "error", message: "That record is no longer in trash." };
            revalidatePath(`/app/${teamSlug}/${resource}`);
            return { status: "success", message: "Record restored." };
        }
        if (intent === "delete") {
            const parsedId = ulidSchema.safeParse(textValue(formData, "id"));

            if (!parsedId.success) {
                return { status: "error", message: "That record is no longer available." };
            }

            if (resource === "companies") {
                await companiesApiDependencies.companies.delete(authentication.context, parsedId.data);
            } else if (resource === "people") {
                await peopleApiDependencies.people.delete(authentication.context, parsedId.data);
            } else if (resource === "opportunities") {
                await opportunitiesApiDependencies.opportunities.delete(authentication.context, parsedId.data);
            } else if (resource === "tasks") {
                await tasksApiDependencies.tasks.delete(authentication.context, parsedId.data);
            } else {
                await notesApiDependencies.notes.delete(authentication.context, parsedId.data);
            }

            revalidatePath(`/app/${teamSlug}`);
            return { status: "success", message: "Record deleted." };
        }

        const value = textValue(formData, "value");
        const companyId = optionalId(formData, "company_id");
        const companyIds = ids(formData, "company_ids");
        const id = ulidSchema.safeParse(textValue(formData, "id"));
        const stagedModelType = intent === "update" && id.success ? mediaModelFor(resource) : "team";
        const stagedModelId = intent === "update" && id.success ? id.data : authentication.context.teamId;
        const { uploaded, replaced } = await uploadCustomFiles(authentication.context, formData, stagedModelType, stagedModelId);
        const custom_fields = customFieldsFromFormData(formData);

        try {
            if (intent === "update") {
                if (!id.success) return { status: "error", message: "That record is no longer available." };
                if (resource === "companies") await companiesApiDependencies.companies.update(authentication.context, id.data, { name: value, custom_fields }, []);
                else if (resource === "people") await peopleApiDependencies.people.update(authentication.context, id.data, { name: value, company_id: companyId, custom_fields }, []);
                else if (resource === "opportunities") await opportunitiesApiDependencies.opportunities.update(authentication.context, id.data, { name: value, company_id: companyId, contact_id: optionalId(formData, "contact_id"), custom_fields }, []);
                else if (resource === "tasks") await tasksApiDependencies.tasks.update(authentication.context, id.data, { title: value, company_ids: companyIds, custom_fields }, []);
                else await notesApiDependencies.notes.update(authentication.context, id.data, { title: value, company_ids: companyIds, custom_fields }, []);
                await Promise.all(replaced.map((uuid) => productionMediaService.remove(authentication.context, uuid).catch((error) => console.error("Replaced custom-field media cleanup failed", { uuid, error }))));
                revalidatePath(`/app/${teamSlug}/${resource}/${id.data}`);
                return { status: "success", message: "Changes saved." };
            }

            let createdId: Ulid;
            if (resource === "companies") {
                const created = await companiesApiDependencies.companies.create(
                authentication.context,
                { name: value, custom_fields },
                [],
                );
                createdId = created.record.id;
            } else if (resource === "people") {
                const created = await peopleApiDependencies.people.create(
                authentication.context,
                { name: value, company_id: companyId, custom_fields },
                [],
                );
                createdId = created.record.id;
            } else if (resource === "opportunities") {
                const created = await opportunitiesApiDependencies.opportunities.create(
                authentication.context,
                {
                    name: value,
                    company_id: companyId,
                    contact_id: optionalId(formData, "contact_id"),
                    custom_fields,
                },
                [],
                );
                createdId = created.record.id;
            } else if (resource === "tasks") {
                const created = await tasksApiDependencies.tasks.create(
                authentication.context,
                {
                    title: value,
                    company_ids: companyIds,
                    custom_fields,
                },
                [],
                );
                createdId = created.record.id;
            } else {
                const created = await notesApiDependencies.notes.create(
                authentication.context,
                {
                    title: value,
                    company_ids: companyIds,
                    custom_fields,
                },
                [],
                );
                createdId = created.record.id;
            }
            await Promise.all(uploaded.map((uuid) => productionMediaService.move(authentication.context, uuid, mediaModelFor(resource), createdId)));

            revalidatePath(`/app/${teamSlug}`);
            return { status: "success", message: "Record created." };
        } catch (error) {
            await Promise.all(uploaded.map((uuid) => productionMediaService.remove(authentication.context, uuid).catch(() => undefined)));
            throw error;
        }
    } catch (error) {
        if (error instanceof ApiValidationError) {
            return {
                status: "error",
                message: error.issues[0]?.message ?? "Check the form and try again.",
            };
        }

        console.error("Browser CRM mutation failed", { resource, intent, error });
        return { status: "error", message: "The record could not be saved. Try again." };
    }
};

export const moveBoardCard = async (
    teamSlug: string,
    resource: "opportunities" | "tasks",
    input: Readonly<{ id: string; fieldCode: string; optionId: string; orderedIds: readonly string[] }>,
): Promise<{ ok: boolean; message?: string }> => {
    const authentication = await requireBrowserTeam(teamSlug);
    const parsedId = ulidSchema.safeParse(input.id);
    const parsedOrder = input.orderedIds.map((id) => ulidSchema.safeParse(id));
    if (!parsedId.success || parsedOrder.some((id) => !id.success)) return { ok: false, message: "Invalid board update." };
    try {
        const body = { custom_fields: { [input.fieldCode]: input.optionId === "unassigned" ? null : input.optionId } };
        if (resource === "opportunities") await opportunitiesApiDependencies.opportunities.update(authentication.context, parsedId.data, body, []);
        else await tasksApiDependencies.tasks.update(authentication.context, parsedId.data, body, []);
        await updateBoardOrder(authentication.context, resource, parsedOrder.map((id) => id.data as Ulid));
        revalidatePath(`/app/${teamSlug}/${resource}`);
        return { ok: true };
    } catch (error) {
        console.error("Browser board update failed", { resource, error });
        return { ok: false, message: "The card could not be moved." };
    }
};
