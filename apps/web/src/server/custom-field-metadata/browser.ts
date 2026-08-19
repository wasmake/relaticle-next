import { and, asc, count, eq, max } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { customFieldOptions, customFields, customFieldSections, customFieldValues, teams, teamUser } from "@/server/db/schema";
import { createUlid, type Ulid } from "@/server/ids";
import { customFieldEntityTypes, customFieldTypes, type CustomFieldEntityType } from "@/server/custom-fields/types";

export class CustomFieldAuthorizationError extends Error {}
export class CustomFieldInputError extends Error {}

export const assertCustomFieldTypeChange = (currentType: string, nextType: string, valueCount: number): void => {
    if (currentType !== nextType && valueCount > 0) throw new CustomFieldInputError("A field's type cannot be changed after values have been saved.");
};

export const belongsToCustomFieldReorderGroup = (
    kind: "section" | "field" | "option",
    current: Readonly<{ entityType?: string; customFieldSectionId?: string | null; customFieldId?: string }>,
    candidate: Readonly<{ entityType?: string; customFieldSectionId?: string | null; customFieldId?: string }>,
): boolean => kind === "section" ? current.entityType === candidate.entityType
    : kind === "field" ? current.entityType === candidate.entityType && current.customFieldSectionId === candidate.customFieldSectionId
    : current.customFieldId === candidate.customFieldId;

export const canManageWorkspace = async (userId: Ulid, teamId: Ulid): Promise<boolean> => {
    const [access] = await getDatabase().select({ ownerId: teams.userId, role: teamUser.role })
        .from(teams).leftJoin(teamUser, and(eq(teamUser.teamId, teams.id), eq(teamUser.userId, userId)))
        .where(eq(teams.id, teamId)).limit(1);
    return access !== undefined && (access.ownerId === userId || access.role === "admin");
};

const requireManager = async (userId: Ulid, teamId: Ulid): Promise<void> => {
    if (!await canManageWorkspace(userId, teamId)) throw new CustomFieldAuthorizationError("Workspace administrator access is required.");
};

export const listCustomFieldConfiguration = async (teamId: Ulid) => {
    const database = getDatabase();
    const [sections, fields, options] = await Promise.all([
        database.select().from(customFieldSections).where(eq(customFieldSections.tenantId, teamId)).orderBy(asc(customFieldSections.sortOrder), asc(customFieldSections.name)),
        database.select().from(customFields).where(eq(customFields.tenantId, teamId)).orderBy(asc(customFields.sortOrder), asc(customFields.name)),
        database.select().from(customFieldOptions).where(eq(customFieldOptions.tenantId, teamId)).orderBy(asc(customFieldOptions.sortOrder), asc(customFieldOptions.name)),
    ]);
    return { sections, fields, options };
};

const cleanCode = (value: string): string => value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "").slice(0, 255);

export const createCustomFieldSection = async (userId: Ulid, teamId: Ulid, input: { name: string; entityType: string }): Promise<void> => {
    await requireManager(userId, teamId);
    const name = input.name.trim();
    if (name === "" || !customFieldEntityTypes.includes(input.entityType as CustomFieldEntityType)) throw new CustomFieldInputError("Enter a section name and valid record type.");
    const database = getDatabase();
    const [highest] = await database.select({ value: max(customFieldSections.sortOrder) }).from(customFieldSections).where(and(eq(customFieldSections.tenantId, teamId), eq(customFieldSections.entityType, input.entityType)));
    const now = new Date();
    await database.insert(customFieldSections).values({ id: createUlid(), tenantId: teamId, code: `${cleanCode(name)}_${createUlid().slice(-4).toLowerCase()}`, name, type: "section", entityType: input.entityType, sortOrder: (highest?.value ?? 0n) + 1n, active: true, systemDefined: false, createdAt: now, updatedAt: now });
};

export const updateCustomFieldSection = async (userId: Ulid, teamId: Ulid, id: string, input: { name: string; entityType: string }): Promise<void> => {
    await requireManager(userId, teamId);
    const name = input.name.trim();
    if (name === "" || !customFieldEntityTypes.includes(input.entityType as CustomFieldEntityType)) throw new CustomFieldInputError("Enter a section name and valid record type.");
    const [section] = await getDatabase().select({ entityType: customFieldSections.entityType }).from(customFieldSections).where(and(eq(customFieldSections.id, id as Ulid), eq(customFieldSections.tenantId, teamId))).limit(1);
    if (section === undefined || section.entityType !== input.entityType) throw new CustomFieldInputError("A section's record type cannot be changed after it is created.");
    await getDatabase().update(customFieldSections).set({ name, updatedAt: new Date() }).where(and(eq(customFieldSections.id, id as Ulid), eq(customFieldSections.tenantId, teamId)));
};

export const saveCustomField = async (userId: Ulid, teamId: Ulid, input: Readonly<{ id?: string; name: string; code: string; type: string; entityType: string; sectionId: string | null; required: boolean; minimum?: string; maximum?: string; options: readonly string[] }>): Promise<void> => {
    await requireManager(userId, teamId);
    const name = input.name.trim();
    const code = cleanCode(input.code || name);
    if (name === "" || code === "" || !customFieldTypes.includes(input.type as (typeof customFieldTypes)[number]) || !customFieldEntityTypes.includes(input.entityType as CustomFieldEntityType)) throw new CustomFieldInputError("Enter a valid field name, code, type, and record type.");
    const rules: Record<string, boolean | number> = { ...(input.required ? { required: true } : {}) };
    if (input.minimum !== undefined && input.minimum !== "") rules[input.type === "number" || input.type === "currency" ? "min_value" : "min_length"] = Number(input.minimum);
    if (input.maximum !== undefined && input.maximum !== "") rules[input.type === "number" || input.type === "currency" ? "max_value" : "max_length"] = Number(input.maximum);
    const database = getDatabase();
    const now = new Date();
    const fieldId = input.id === undefined ? createUlid() : input.id as Ulid;
    const labels = [...new Set(input.options.map((label) => label.trim()).filter(Boolean))];
    await database.transaction(async (transaction) => {
        if (input.sectionId !== null) {
            const [section] = await transaction.select({ id: customFieldSections.id }).from(customFieldSections).where(and(eq(customFieldSections.id, input.sectionId as Ulid), eq(customFieldSections.tenantId, teamId), eq(customFieldSections.entityType, input.entityType))).limit(1);
            if (section === undefined) throw new CustomFieldInputError("Select a section from the same workspace and record type.");
        }
        const [existingField] = input.id === undefined ? [] : await transaction.select({ type: customFields.type, entityType: customFields.entityType }).from(customFields).where(and(eq(customFields.id, fieldId), eq(customFields.tenantId, teamId))).limit(1).for("update");
        if (input.id !== undefined && existingField === undefined) throw new CustomFieldInputError("That custom field is no longer available.");
        if (existingField !== undefined && existingField.entityType !== input.entityType) throw new CustomFieldInputError("A field's record type cannot be changed after it is created.");
        if (existingField !== undefined && existingField.type !== input.type) {
            const [values] = await transaction.select({ value: count() }).from(customFieldValues).where(and(eq(customFieldValues.tenantId, teamId), eq(customFieldValues.customFieldId, fieldId)));
            assertCustomFieldTypeChange(existingField.type, input.type, values?.value ?? 0);
        }
        const existingOptions = existingField === undefined ? [] : await transaction.select().from(customFieldOptions).where(and(eq(customFieldOptions.customFieldId, fieldId), eq(customFieldOptions.tenantId, teamId)));
        if (input.id === undefined) {
            const [highest] = await transaction.select({ value: max(customFields.sortOrder) }).from(customFields).where(and(eq(customFields.tenantId, teamId), eq(customFields.entityType, input.entityType)));
            await transaction.insert(customFields).values({ id: fieldId, tenantId: teamId, customFieldSectionId: input.sectionId as Ulid | null, code, name, type: input.type, entityType: input.entityType, sortOrder: (highest?.value ?? 0n) + 1n, validationRules: rules, active: true, systemDefined: false, createdAt: now, updatedAt: now });
        } else {
            await transaction.update(customFields).set({ customFieldSectionId: input.sectionId as Ulid | null, name, code, type: input.type, validationRules: rules, updatedAt: now }).where(and(eq(customFields.id, fieldId), eq(customFields.tenantId, teamId), eq(customFields.entityType, input.entityType)));
        }
        for (const option of existingOptions) {
            const index = labels.indexOf(option.name ?? "");
            if (index === -1) await transaction.delete(customFieldOptions).where(and(eq(customFieldOptions.id, option.id), eq(customFieldOptions.tenantId, teamId), eq(customFieldOptions.customFieldId, fieldId)));
            else await transaction.update(customFieldOptions).set({ sortOrder: BigInt(index + 1), updatedAt: now }).where(and(eq(customFieldOptions.id, option.id), eq(customFieldOptions.tenantId, teamId), eq(customFieldOptions.customFieldId, fieldId)));
        }
        const existingLabels = new Set(existingOptions.map((option) => option.name));
        const additions = labels.flatMap((label, index) => existingLabels.has(label) ? [] : [{ id: createUlid(), tenantId: teamId, customFieldId: fieldId, name: label, sortOrder: BigInt(index + 1), createdAt: now, updatedAt: now }]);
        if (additions.length > 0) await transaction.insert(customFieldOptions).values(additions);
    });
};

export const reorderCustomField = async (userId: Ulid, teamId: Ulid, kind: "section" | "field" | "option", id: string, direction: -1 | 1): Promise<void> => {
    await requireManager(userId, teamId);
    const configuration = await listCustomFieldConfiguration(teamId);
    const allRows = kind === "section" ? configuration.sections : kind === "field" ? configuration.fields : configuration.options;
    const selected = allRows.find((row) => row.id === id);
    const rows = selected === undefined ? [] : allRows.filter((row) => belongsToCustomFieldReorderGroup(kind, selected, row));
    const index = rows.findIndex((row) => row.id === id);
    const other = rows[index + direction];
    const current = rows[index];
    if (current === undefined || other === undefined) return;
    const table = kind === "section" ? customFieldSections : kind === "field" ? customFields : customFieldOptions;
    await getDatabase().transaction(async (transaction) => {
        await transaction.update(table).set({ sortOrder: other.sortOrder }).where(and(eq(table.id, current.id), eq(table.tenantId, teamId)));
        await transaction.update(table).set({ sortOrder: current.sortOrder }).where(and(eq(table.id, other.id), eq(table.tenantId, teamId)));
    });
};

export const setCustomFieldActive = async (userId: Ulid, teamId: Ulid, id: string, active: boolean): Promise<void> => {
    await requireManager(userId, teamId);
    await getDatabase().update(customFields).set({ active, updatedAt: new Date() }).where(and(eq(customFields.id, id as Ulid), eq(customFields.tenantId, teamId)));
};

export const setCustomFieldSectionActive = async (userId: Ulid, teamId: Ulid, id: string, active: boolean): Promise<void> => {
    await requireManager(userId, teamId);
    await getDatabase().update(customFieldSections).set({ active, updatedAt: new Date() }).where(and(eq(customFieldSections.id, id as Ulid), eq(customFieldSections.tenantId, teamId)));
};
