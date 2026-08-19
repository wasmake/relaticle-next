import { and, eq, inArray, isNull } from "drizzle-orm";

import type { CompaniesService } from "@/server/companies/service";
import type { RequestContext } from "@/server/context/request-context";
import { DrizzleCustomFieldRepository } from "@/server/custom-fields/drizzle-repository";
import type { CustomFieldEntityType } from "@/server/custom-fields/types";
import { getDatabase } from "@/server/db/client";
import {
    companies,
    noteables,
    notes,
    opportunities,
    people,
    tasks,
    taskables,
    taskUser,
} from "@/server/db/schema";
import { ulidSchema, type Ulid } from "@/server/ids";
import type { NotesService } from "@/server/notes/service";
import type { OpportunitiesService } from "@/server/opportunities/service";
import type { PeopleService } from "@/server/people/service";
import type { CustomFieldsService } from "@/server/custom-fields/service";
import type { TasksService } from "@/server/tasks/service";

import type { CsvEntityPort, CsvExportRecord, CsvResource } from "./types";

type Database = ReturnType<typeof getDatabase>;

const customEntityType: Record<CsvResource, CustomFieldEntityType> = {
    companies: "company", people: "people", opportunities: "opportunity",
    tasks: "task", notes: "note",
};

const iso = (value: Date | null): string => value?.toISOString() ?? "";
const list = (values: readonly string[]): string => JSON.stringify(values);

const relationshipKind = (value: string): "company" | "people" | "opportunity" | undefined => {
    const normalized = value.toLowerCase();
    if (normalized === "company" || normalized.endsWith("\\company")) return "company";
    if (normalized === "people" || normalized === "person" || normalized.endsWith("\\person")) return "people";
    if (normalized === "opportunity" || normalized.endsWith("\\opportunity")) return "opportunity";
    return undefined;
};

const withoutId = (values: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> =>
    Object.fromEntries(Object.entries(values).filter(([key]) => key !== "id"));

export class DrizzleCsvEntityPort implements CsvEntityPort {
    public constructor(
        private readonly services: Readonly<{
            companies: CompaniesService;
            people: PeopleService;
            opportunities: OpportunitiesService;
            tasks: TasksService;
            notes: NotesService;
        }>,
        private readonly customFields: CustomFieldsService,
        private readonly database: Database = getDatabase(),
        private readonly definitions = new DrizzleCustomFieldRepository(database),
    ) {}

    public customFieldDefinitions(teamId: Ulid, resource: CsvResource) {
        return this.definitions.loadActiveDefinitions(teamId, customEntityType[resource]);
    }

    public async exportRecords(context: RequestContext, resource: CsvResource): Promise<readonly CsvExportRecord[]> {
        if (resource === "companies") {
            const rows = await this.database.select().from(companies).where(and(eq(companies.teamId, context.teamId), isNull(companies.deletedAt)));
            return Promise.all(rows.map(async (row) => ({ id: ulidSchema.parse(row.id), values: {
                id: row.id, name: row.name, created_at: iso(row.createdAt), updated_at: iso(row.updatedAt),
            }, customFields: await this.customFields.format(context, "company", ulidSchema.parse(row.id)) })));
        }
        if (resource === "people") {
            const rows = await this.database.select().from(people).where(and(eq(people.teamId, context.teamId), isNull(people.deletedAt)));
            return Promise.all(rows.map(async (row) => ({ id: ulidSchema.parse(row.id), values: {
                id: row.id, name: row.name, company_id: row.companyId ?? "", created_at: iso(row.createdAt), updated_at: iso(row.updatedAt),
            }, customFields: await this.customFields.format(context, "people", ulidSchema.parse(row.id)) })));
        }
        if (resource === "opportunities") {
            const rows = await this.database.select().from(opportunities).where(and(eq(opportunities.teamId, context.teamId), isNull(opportunities.deletedAt)));
            return Promise.all(rows.map(async (row) => ({ id: ulidSchema.parse(row.id), values: {
                id: row.id, name: row.name, company_id: row.companyId ?? "", contact_id: row.contactId ?? "", created_at: iso(row.createdAt), updated_at: iso(row.updatedAt),
            }, customFields: await this.customFields.format(context, "opportunity", ulidSchema.parse(row.id)) })));
        }
        if (resource === "tasks") return this.exportTasks(context);
        return this.exportNotes(context);
    }

    public async upsertRecord(context: RequestContext, resource: CsvResource, values: Readonly<Record<string, unknown>>): Promise<"created" | "updated"> {
        const suppliedId = values.id;
        const id = typeof suppliedId === "string" && suppliedId !== "" ? ulidSchema.parse(suppliedId) : undefined;
        const body = withoutId(values);
        if (resource === "companies") {
            if (id === undefined) await this.services.companies.create(context, body, []);
            else await this.services.companies.update(context, id, body, []);
        } else if (resource === "people") {
            if (id === undefined) await this.services.people.create(context, body, []);
            else await this.services.people.update(context, id, body, []);
        } else if (resource === "opportunities") {
            if (id === undefined) await this.services.opportunities.create(context, body, []);
            else await this.services.opportunities.update(context, id, body, []);
        } else if (resource === "tasks") {
            if (id === undefined) await this.services.tasks.create(context, body, []);
            else await this.services.tasks.update(context, id, body, []);
        } else if (id === undefined) {
            await this.services.notes.create(context, body, []);
        } else {
            await this.services.notes.update(context, id, body, []);
        }
        return id === undefined ? "created" : "updated";
    }

    private async exportTasks(context: RequestContext): Promise<readonly CsvExportRecord[]> {
        const rows = await this.database.select().from(tasks).where(and(eq(tasks.teamId, context.teamId), isNull(tasks.deletedAt)));
        const ids = rows.map(({ id }) => id);
        const relationships = ids.length === 0 ? [] : await this.database.select().from(taskables).where(inArray(taskables.taskId, ids));
        const assignees = ids.length === 0 ? [] : await this.database.select().from(taskUser).where(inArray(taskUser.taskId, ids));
        return Promise.all(rows.map(async (row) => {
            const grouped = { company: [] as string[], people: [] as string[], opportunity: [] as string[] };
            for (const relationship of relationships.filter(({ taskId }) => taskId === row.id)) {
                const kind = relationshipKind(relationship.taskableType);
                if (kind !== undefined) grouped[kind].push(relationship.taskableId);
            }
            return { id: ulidSchema.parse(row.id), values: {
                id: row.id, title: row.title, company_ids: list(grouped.company), people_ids: list(grouped.people),
                opportunity_ids: list(grouped.opportunity), assignee_ids: list(assignees.filter(({ taskId }) => taskId === row.id).map(({ userId }) => userId)),
                created_at: iso(row.createdAt), updated_at: iso(row.updatedAt),
            }, customFields: await this.customFields.format(context, "task", ulidSchema.parse(row.id)) };
        }));
    }

    private async exportNotes(context: RequestContext): Promise<readonly CsvExportRecord[]> {
        const rows = await this.database.select().from(notes).where(and(eq(notes.teamId, context.teamId), isNull(notes.deletedAt)));
        const ids = rows.map(({ id }) => id);
        const relationships = ids.length === 0 ? [] : await this.database.select().from(noteables).where(inArray(noteables.noteId, ids));
        return Promise.all(rows.map(async (row) => {
            const grouped = { company: [] as string[], people: [] as string[], opportunity: [] as string[] };
            for (const relationship of relationships.filter(({ noteId }) => noteId === row.id)) {
                const kind = relationshipKind(relationship.noteableType);
                if (kind !== undefined) grouped[kind].push(relationship.noteableId);
            }
            return { id: ulidSchema.parse(row.id), values: {
                id: row.id, title: row.title, company_ids: list(grouped.company), people_ids: list(grouped.people),
                opportunity_ids: list(grouped.opportunity), created_at: iso(row.createdAt), updated_at: iso(row.updatedAt),
            }, customFields: await this.customFields.format(context, "note", ulidSchema.parse(row.id)) };
        }));
    }
}
