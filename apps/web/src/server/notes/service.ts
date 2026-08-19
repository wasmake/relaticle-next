import { ApiNotFoundError, ApiValidationError } from "@/server/api/errors";
import type { RequestContext } from "@/server/context/request-context";
import type {
    CustomFieldsApiObject,
    CustomFieldWriteRequest,
    PreparedCustomFieldWrite,
} from "@/server/custom-fields/types";
import { createUlid, type Ulid } from "@/server/ids";

import type { NotesRepository } from "./repository";
import {
    noteCountIncludes,
    noteableTypes,
    type NoteCompanyRecord,
    type NoteCompanyView,
    type NoteInclude,
    type NoteListQuery,
    type NoteListView,
    type NoteOpportunityRecord,
    type NoteOpportunityView,
    type NotePersonRecord,
    type NotePersonView,
    type NoteRecord,
    type NoteRelationshipCounts,
    type NoteRelationshipSyncs,
    type NoteUserRecord,
    type NoteView,
    type NoteableType,
} from "./types";
import { validateCreateNote, validateUpdateNote } from "./validation";

export interface NoteCustomFieldsService {
    prepareWrite(
        context: Pick<RequestContext, "teamId">,
        request: CustomFieldWriteRequest,
    ): Promise<PreparedCustomFieldWrite>;
    format(
        context: Pick<RequestContext, "teamId">,
        entityType: "company" | "people" | "opportunity" | "note",
        entityId: Ulid,
    ): Promise<CustomFieldsApiObject>;
}

const relationshipFields = {
    company: "company_ids",
    people: "people_ids",
    opportunity: "opportunity_ids",
} as const satisfies Record<NoteableType, string>;

const groupByNote = <T extends { record: { noteId: Ulid } }>(
    records: readonly T[],
): ReadonlyMap<Ulid, readonly T[]> => {
    const grouped = new Map<Ulid, T[]>();

    for (const record of records) {
        const values = grouped.get(record.record.noteId) ?? [];
        values.push(record);
        grouped.set(record.record.noteId, values);
    }

    return grouped;
};

const assertPreparedWrite = (
    context: RequestContext,
    noteId: Ulid,
    prepared: PreparedCustomFieldWrite,
): void => {
    const invalidMutation = prepared.mutations.some(
        (mutation) =>
            mutation.teamId !== context.teamId ||
            mutation.entityType !== "note" ||
            mutation.entityId !== noteId,
    );
    const invalidPromotion = prepared.optionPromotions.some(
        (promotion) => promotion.teamId !== context.teamId,
    );

    if (
        prepared.teamId !== context.teamId ||
        prepared.entityType !== "note" ||
        prepared.entityId !== noteId ||
        invalidMutation ||
        invalidPromotion
    ) {
        throw new Error(
            "Prepared custom fields do not match the note transaction.",
        );
    }
};

export class NotesService {
    public constructor(
        private readonly repository: NotesRepository,
        private readonly customFields: NoteCustomFieldsService,
        private readonly now: () => Date = () => new Date(),
        private readonly createId: () => Ulid = createUlid,
    ) {}

    public async list(
        context: RequestContext,
        query: NoteListQuery,
    ): Promise<NoteListView> {
        const page = await this.repository.list(context.teamId, query);

        return {
            notes: await this.loadViews(context, page.records, query.includes),
            page: query.page,
            perPage: query.perPage,
            total: page.total,
        };
    }

    public async show(
        context: RequestContext,
        noteId: Ulid,
        includes: readonly NoteInclude[],
    ): Promise<NoteView> {
        const note = await this.repository.find(context.teamId, noteId);

        if (note === undefined) {
            throw new ApiNotFoundError();
        }

        const [view] = await this.loadViews(context, [note], includes);

        if (view === undefined) {
            throw new ApiNotFoundError();
        }

        return view;
    }

    public async create(
        context: RequestContext,
        body: Readonly<Record<string, unknown>>,
        includes: readonly NoteInclude[],
        creationSource: "api" | "chat" = "api",
    ): Promise<NoteView> {
        const data = validateCreateNote(body);
        await this.assertRelationshipsOwned(context, data.relationships);

        const id = this.createId();
        const customFields = await this.customFields.prepareWrite(context, {
            entityType: "note",
            entityId: id,
            operation: "create",
            ...(Object.hasOwn(data, "customFields")
                ? { customFields: data.customFields }
                : {}),
        });
        assertPreparedWrite(context, id, customFields);

        const note = await this.repository.create({
            id,
            teamId: context.teamId,
            creatorId: context.userId,
            title: data.title,
            creationSource,
            occurredAt: this.now(),
            relationships: data.relationships,
            customFields,
        });
        const [view] = await this.loadViews(context, [note], includes);

        if (view === undefined) {
            throw new Error("The created note could not be loaded.");
        }

        return view;
    }

    public async update(
        context: RequestContext,
        noteId: Ulid,
        body: Readonly<Record<string, unknown>>,
        includes: readonly NoteInclude[],
    ): Promise<NoteView> {
        const existing = await this.repository.find(context.teamId, noteId);

        if (existing === undefined) {
            throw new ApiNotFoundError();
        }

        const data = validateUpdateNote(body);
        await this.assertRelationshipsOwned(context, data.relationships);

        const hasCustomFields = Object.hasOwn(data, "customFields");
        const customFields = hasCustomFields
            ? await this.customFields.prepareWrite(context, {
                  entityType: "note",
                  entityId: noteId,
                  operation: "update",
                  customFields: data.customFields,
              })
            : undefined;

        if (customFields !== undefined) {
            assertPreparedWrite(context, noteId, customFields);
        }

        let note = existing;

        if (
            data.title !== undefined ||
            customFields !== undefined ||
            Object.keys(data.relationships).length > 0
        ) {
            const updated = await this.repository.update(
                {
                    id: noteId,
                    teamId: context.teamId,
                    occurredAt: this.now(),
                    relationships: data.relationships,
                    ...(data.title === undefined ? {} : { title: data.title }),
                    ...(customFields === undefined ? {} : { customFields }),
                },
                context.userId,
            );

            if (updated === undefined) {
                throw new ApiNotFoundError();
            }

            note = updated;
        }

        const [view] = await this.loadViews(context, [note], includes);

        if (view === undefined) {
            throw new ApiNotFoundError();
        }

        return view;
    }

    public async delete(context: RequestContext, noteId: Ulid): Promise<void> {
        const existing = await this.repository.find(context.teamId, noteId);

        if (existing === undefined) {
            throw new ApiNotFoundError();
        }

        const deleted = await this.repository.softDelete(
            context.teamId,
            noteId,
            this.now(),
            context.userId,
        );

        if (!deleted) {
            throw new ApiNotFoundError();
        }
    }

    private async assertRelationshipsOwned(
        context: RequestContext,
        relationships: NoteRelationshipSyncs,
    ): Promise<void> {
        const issues: Array<{ path: string; message: string }> = [];

        for (const type of noteableTypes) {
            const ids = relationships[type];

            if (ids === undefined || ids.length === 0) {
                continue;
            }

            const owned = await this.repository.findOwnedRelationshipIds(
                context.teamId,
                type,
                ids,
            );
            const path = relationshipFields[type];

            for (const [index, id] of ids.entries()) {
                if (!owned.has(id)) {
                    issues.push({
                        path: `${path}.${index}`,
                        message: `The selected ${path}.${index} is invalid.`,
                    });
                }
            }
        }

        if (issues.length > 0) {
            throw new ApiValidationError(issues);
        }
    }

    private async loadViews(
        context: RequestContext,
        notes: readonly NoteRecord[],
        includes: readonly NoteInclude[],
    ): Promise<readonly NoteView[]> {
        if (notes.length === 0) {
            return [];
        }

        const includeSet = new Set(includes);
        const noteIds = notes.map((note) => note.id);
        const users = includeSet.has("creator")
            ? await this.repository.loadUsers(context.teamId, notes)
            : [];
        const usersById = new Map<Ulid, NoteUserRecord>(
            users.map((user) => [user.id, user]),
        );
        const companies = includeSet.has("companies")
            ? await this.loadCompanies(context, noteIds)
            : [];
        const people = includeSet.has("people")
            ? await this.loadPeople(context, noteIds)
            : [];
        const opportunities = includeSet.has("opportunities")
            ? await this.loadOpportunities(context, noteIds)
            : [];
        const companiesByNote = groupByNote(companies);
        const peopleByNote = groupByNote(people);
        const opportunitiesByNote = groupByNote(opportunities);
        const countIncludes = noteCountIncludes.filter((include) =>
            includeSet.has(include),
        );
        const counts =
            countIncludes.length === 0
                ? new Map<Ulid, NoteRelationshipCounts>()
                : await this.repository.loadRelationshipCounts(
                      context.teamId,
                      noteIds,
                      countIncludes,
                  );
        const formattedCustomFields = await Promise.all(
            notes.map((note) =>
                this.customFields.format(context, "note", note.id),
            ),
        );

        return notes.map((note, index): NoteView => ({
            record: note,
            customFields: formattedCustomFields[index] ?? {},
            ...(includeSet.has("creator")
                ? {
                      creator:
                          note.creatorId === null
                              ? null
                              : (usersById.get(note.creatorId) ?? null),
                  }
                : {}),
            ...(includeSet.has("companies")
                ? { companies: companiesByNote.get(note.id) ?? [] }
                : {}),
            ...(includeSet.has("people")
                ? { people: peopleByNote.get(note.id) ?? [] }
                : {}),
            ...(includeSet.has("opportunities")
                ? { opportunities: opportunitiesByNote.get(note.id) ?? [] }
                : {}),
            counts: counts.get(note.id) ?? {},
        }));
    }

    private async loadCompanies(
        context: RequestContext,
        noteIds: readonly Ulid[],
    ): Promise<readonly NoteCompanyView[]> {
        const companies = await this.repository.loadCompanies(
            context.teamId,
            noteIds,
        );

        return Promise.all(
            companies.map(async (record: NoteCompanyRecord) => ({
                record,
                customFields: await this.customFields.format(
                    context,
                    "company",
                    record.id,
                ),
            })),
        );
    }

    private async loadPeople(
        context: RequestContext,
        noteIds: readonly Ulid[],
    ): Promise<readonly NotePersonView[]> {
        const people = await this.repository.loadPeople(
            context.teamId,
            noteIds,
        );

        return Promise.all(
            people.map(async (record: NotePersonRecord) => ({
                record,
                customFields: await this.customFields.format(
                    context,
                    "people",
                    record.id,
                ),
            })),
        );
    }

    private async loadOpportunities(
        context: RequestContext,
        noteIds: readonly Ulid[],
    ): Promise<readonly NoteOpportunityView[]> {
        const opportunities = await this.repository.loadOpportunities(
            context.teamId,
            noteIds,
        );

        return Promise.all(
            opportunities.map(async (record: NoteOpportunityRecord) => ({
                record,
                customFields: await this.customFields.format(
                    context,
                    "opportunity",
                    record.id,
                ),
            })),
        );
    }
}
