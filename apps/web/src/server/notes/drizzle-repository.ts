import {
    and,
    asc,
    desc,
    eq,
    exists,
    ilike,
    inArray,
    isNull,
    sql,
    type SQL,
} from "drizzle-orm";

import type { ActivityWriter } from "@/server/activity/writer";
import {
    persistPreparedCustomFields,
    type DatabaseTransaction,
} from "@/server/custom-fields/persist";
import { getDatabase } from "@/server/db/client";
import {
    companies,
    noteables,
    notes,
    opportunities,
    people,
    users,
} from "@/server/db/schema";
import { ApiValidationError } from "@/server/api/errors";
import { ulidSchema, type Ulid } from "@/server/ids";
import { userBelongsToTeam } from "@/server/tenancy/user-scope";

import type {
    CreateNoteTransaction,
    NotesRepository,
    UpdateNoteTransaction,
} from "./repository";
import {
    noteableTypes,
    type NoteCompanyRecord,
    type NoteCountInclude,
    type NoteListPage,
    type NoteListQuery,
    type NoteOpportunityRecord,
    type NotePersonRecord,
    type NoteRecord,
    type NoteRelationshipCounts,
    type NoteRelationshipSyncs,
    type NoteSort,
    type NoteUserRecord,
    type NoteableType,
} from "./types";

type Database = ReturnType<typeof getDatabase>;
type RelationReader = Database | DatabaseTransaction;

const relationshipFields = {
    company: "company_ids",
    people: "people_ids",
    opportunity: "opportunity_ids",
} as const satisfies Record<NoteableType, string>;

const toNoteRecord = (row: typeof notes.$inferSelect): NoteRecord => ({
    id: ulidSchema.parse(row.id),
    teamId: ulidSchema.parse(row.teamId),
    creatorId: row.creatorId === null ? null : ulidSchema.parse(row.creatorId),
    title: row.title,
    creationSource: row.creationSource,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
});

const orderFor = (sort: NoteSort): SQL => {
    const column =
        sort.field === "title"
            ? notes.title
            : sort.field === "created_at"
              ? notes.createdAt
              : notes.updatedAt;

    return sort.direction === "asc" ? asc(column) : desc(column);
};

const ownedRelationIds = async (
    database: RelationReader,
    teamId: Ulid,
    type: NoteableType,
    ids: readonly Ulid[],
    lock: boolean,
): Promise<ReadonlySet<Ulid>> => {
    if (ids.length === 0) {
        return new Set();
    }

    const uniqueIds = [...new Set(ids)];

    if (type === "company") {
        const query = database
            .select({ id: companies.id })
            .from(companies)
            .where(
                and(
                    eq(companies.teamId, teamId),
                    inArray(companies.id, uniqueIds),
                    isNull(companies.deletedAt),
                ),
            );
        const rows = lock ? await query.for("share") : await query;

        return new Set(rows.map((row) => ulidSchema.parse(row.id)));
    }

    if (type === "people") {
        const query = database
            .select({ id: people.id })
            .from(people)
            .where(
                and(
                    eq(people.teamId, teamId),
                    inArray(people.id, uniqueIds),
                    isNull(people.deletedAt),
                ),
            );
        const rows = lock ? await query.for("share") : await query;

        return new Set(rows.map((row) => ulidSchema.parse(row.id)));
    }

    const query = database
        .select({ id: opportunities.id })
        .from(opportunities)
        .where(
            and(
                eq(opportunities.teamId, teamId),
                inArray(opportunities.id, uniqueIds),
                isNull(opportunities.deletedAt),
            ),
        );
    const rows = lock ? await query.for("share") : await query;

    return new Set(rows.map((row) => ulidSchema.parse(row.id)));
};

const assertRelationshipsOwned = async (
    transaction: DatabaseTransaction,
    teamId: Ulid,
    relationships: NoteRelationshipSyncs,
): Promise<void> => {
    const issues: Array<{ path: string; message: string }> = [];

    for (const type of noteableTypes) {
        const ids = relationships[type];

        if (ids === undefined || ids.length === 0) {
            continue;
        }

        const owned = await ownedRelationIds(
            transaction,
            teamId,
            type,
            ids,
            true,
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
};

const syncRelationships = async (
    transaction: DatabaseTransaction,
    noteId: Ulid,
    relationships: NoteRelationshipSyncs,
    occurredAt: Date,
): Promise<void> => {
    for (const type of noteableTypes) {
        const ids = relationships[type];

        if (ids === undefined) {
            continue;
        }

        await transaction
            .delete(noteables)
            .where(
                and(
                    eq(noteables.noteId, noteId),
                    eq(noteables.noteableType, type),
                ),
            );

        const uniqueIds = [...new Set(ids)];

        if (uniqueIds.length > 0) {
            await transaction.insert(noteables).values(
                uniqueIds.map((id) => ({
                    noteId,
                    noteableType: type,
                    noteableId: id,
                    createdAt: occurredAt,
                    updatedAt: occurredAt,
                })),
            );
        }
    }
};

const initializeCounts = (
    noteIds: readonly Ulid[],
): Map<Ulid, NoteRelationshipCounts> =>
    new Map(noteIds.map((noteId) => [noteId, {}]));

const setCount = (
    counts: Map<Ulid, NoteRelationshipCounts>,
    noteId: string,
    key: keyof NoteRelationshipCounts,
    value: number,
): void => {
    const id = ulidSchema.parse(noteId);
    counts.set(id, { ...counts.get(id), [key]: value });
};

export class DrizzleNotesRepository implements NotesRepository {
    public constructor(
        private readonly activity: ActivityWriter,
        private readonly database: Database = getDatabase(),
    ) {}

    public async list(
        teamId: Ulid,
        query: NoteListQuery,
    ): Promise<NoteListPage> {
        const conditions: SQL[] = [
            eq(notes.teamId, teamId),
            isNull(notes.deletedAt),
        ];

        if (query.filters.title !== undefined) {
            conditions.push(ilike(notes.title, `%${query.filters.title}%`));
        }

        if (query.filters.notableType !== undefined) {
            conditions.push(
                exists(
                    this.database
                        .select({ id: noteables.id })
                        .from(noteables)
                        .where(
                            and(
                                eq(noteables.noteId, notes.id),
                                eq(
                                    noteables.noteableType,
                                    query.filters.notableType,
                                ),
                            ),
                        ),
                ),
            );
        }

        if (query.filters.notableId !== undefined) {
            conditions.push(
                exists(
                    this.database
                        .select({ id: noteables.id })
                        .from(noteables)
                        .where(
                            and(
                                eq(noteables.noteId, notes.id),
                                eq(
                                    noteables.noteableId,
                                    query.filters.notableId,
                                ),
                            ),
                        ),
                ),
            );
        }

        if (query.filters.createdAfter !== undefined) {
            conditions.push(
                sql`${notes.createdAt}::date >= ${query.filters.createdAfter}::date`,
            );
        }

        if (query.filters.createdBefore !== undefined) {
            conditions.push(
                sql`${notes.createdAt}::date <= ${query.filters.createdBefore}::date`,
            );
        }

        const where = and(...conditions);
        const [rows, totalRows] = await Promise.all([
            this.database
                .select()
                .from(notes)
                .where(where)
                .orderBy(...query.sorts.map(orderFor), asc(notes.id))
                .limit(query.perPage)
                .offset((query.page - 1) * query.perPage),
            this.database
                .select({ total: sql<number>`count(*)::integer` })
                .from(notes)
                .where(where),
        ]);

        return {
            records: rows.map(toNoteRecord),
            total: totalRows[0]?.total ?? 0,
        };
    }

    public async find(
        teamId: Ulid,
        noteId: Ulid,
    ): Promise<NoteRecord | undefined> {
        const [note] = await this.database
            .select()
            .from(notes)
            .where(
                and(
                    eq(notes.teamId, teamId),
                    eq(notes.id, noteId),
                    isNull(notes.deletedAt),
                ),
            )
            .limit(1);

        return note === undefined ? undefined : toNoteRecord(note);
    }

    public findOwnedRelationshipIds(
        teamId: Ulid,
        type: NoteableType,
        ids: readonly Ulid[],
    ): Promise<ReadonlySet<Ulid>> {
        return ownedRelationIds(this.database, teamId, type, ids, false);
    }

    public async create(input: CreateNoteTransaction): Promise<NoteRecord> {
        return this.database.transaction(async (transaction) => {
            const batchUuid = this.activity.batchUuid();
            await assertRelationshipsOwned(
                transaction,
                input.teamId,
                input.relationships,
            );

            const [created] = await transaction
                .insert(notes)
                .values({
                    id: input.id,
                    teamId: input.teamId,
                    creatorId: input.creatorId,
                    title: input.title,
                    creationSource: input.creationSource,
                    createdAt: input.occurredAt,
                    updatedAt: input.occurredAt,
                    deletedAt: null,
                })
                .returning();

            if (created === undefined) {
                throw new Error("Note insert did not return the created row.");
            }

            await syncRelationships(
                transaction,
                input.id,
                input.relationships,
                input.occurredAt,
            );
            await this.activity.writeNative(transaction, {
                teamId: input.teamId,
                subjectType: "note",
                subjectId: input.id,
                causerId: input.creatorId,
                event: "created",
                attributes: { title: input.title },
                batchUuid,
                occurredAt: input.occurredAt,
            });
            await this.activity.writeCustomFields(
                transaction,
                input.customFields,
                input.creatorId,
                batchUuid,
                input.occurredAt,
            );
            await persistPreparedCustomFields(
                transaction,
                input.customFields,
                input.occurredAt,
            );

            return toNoteRecord(created);
        });
    }

    public async update(
        input: UpdateNoteTransaction,
        causerId: Ulid,
    ): Promise<NoteRecord | undefined> {
        return this.database.transaction(async (transaction) => {
            const batchUuid = this.activity.batchUuid();
            const [current] = await transaction
                .select()
                .from(notes)
                .where(
                    and(
                        eq(notes.teamId, input.teamId),
                        eq(notes.id, input.id),
                        isNull(notes.deletedAt),
                    ),
                )
                .limit(1)
                .for("update");

            if (current === undefined) {
                return undefined;
            }

            await assertRelationshipsOwned(
                transaction,
                input.teamId,
                input.relationships,
            );

            let note = current;

            if (
                input.title !== undefined ||
                input.customFields !== undefined ||
                Object.keys(input.relationships).length > 0
            ) {
                const [updated] = await transaction
                    .update(notes)
                    .set({
                        updatedAt: input.occurredAt,
                        ...(input.title === undefined
                            ? {}
                            : { title: input.title }),
                    })
                    .where(
                        and(
                            eq(notes.teamId, input.teamId),
                            eq(notes.id, input.id),
                            isNull(notes.deletedAt),
                        ),
                    )
                    .returning();

                if (updated === undefined) {
                    return undefined;
                }

                note = updated;
            }

            const titleChanged = current.title !== note.title;

            await this.activity.writeNative(transaction, {
                teamId: input.teamId,
                subjectType: "note",
                subjectId: input.id,
                causerId,
                event: "updated",
                attributes: titleChanged ? { title: note.title } : {},
                old: titleChanged ? { title: current.title } : {},
                batchUuid,
                occurredAt: input.occurredAt,
            });

            await syncRelationships(
                transaction,
                input.id,
                input.relationships,
                input.occurredAt,
            );

            if (input.customFields !== undefined) {
                await this.activity.writeCustomFields(
                    transaction,
                    input.customFields,
                    causerId,
                    batchUuid,
                    input.occurredAt,
                );
                await persistPreparedCustomFields(
                    transaction,
                    input.customFields,
                    input.occurredAt,
                );
            }

            return toNoteRecord(note);
        });
    }

    public async softDelete(
        teamId: Ulid,
        noteId: Ulid,
        occurredAt: Date,
        causerId: Ulid,
    ): Promise<boolean> {
        return this.database.transaction(async (transaction) => {
            const [deleted] = await transaction
                .update(notes)
                .set({ deletedAt: occurredAt, updatedAt: occurredAt })
                .where(
                    and(
                        eq(notes.teamId, teamId),
                        eq(notes.id, noteId),
                        isNull(notes.deletedAt),
                    ),
                )
                .returning({ id: notes.id });

            if (deleted === undefined) {
                return false;
            }

            await this.activity.writeNative(transaction, {
                teamId,
                subjectType: "note",
                subjectId: noteId,
                causerId,
                event: "deleted",
                batchUuid: this.activity.batchUuid(),
                occurredAt,
            });

            return true;
        });
    }

    public async loadUsers(
        teamId: Ulid,
        noteRecords: readonly NoteRecord[],
    ): Promise<readonly NoteUserRecord[]> {
        if (noteRecords.length === 0) {
            return [];
        }

        const rows = await this.database
            .selectDistinct({
                id: users.id,
                name: users.name,
                email: users.email,
            })
            .from(users)
            .innerJoin(notes, eq(notes.creatorId, users.id))
            .where(
                and(
                    eq(notes.teamId, teamId),
                    inArray(
                        notes.id,
                        noteRecords.map((note) => note.id),
                    ),
                    isNull(notes.deletedAt),
                    userBelongsToTeam(users.id, teamId),
                ),
            );

        return rows.map((row) => ({
            id: ulidSchema.parse(row.id),
            name: row.name,
            email: row.email,
        }));
    }

    public async loadCompanies(
        teamId: Ulid,
        noteIds: readonly Ulid[],
    ): Promise<readonly NoteCompanyRecord[]> {
        if (noteIds.length === 0) {
            return [];
        }

        const rows = await this.database
            .select({
                noteId: noteables.noteId,
                id: companies.id,
                teamId: companies.teamId,
                name: companies.name,
                creationSource: companies.creationSource,
                createdAt: companies.createdAt,
                updatedAt: companies.updatedAt,
            })
            .from(noteables)
            .innerJoin(companies, eq(companies.id, noteables.noteableId))
            .where(
                and(
                    inArray(noteables.noteId, noteIds),
                    eq(noteables.noteableType, "company"),
                    eq(companies.teamId, teamId),
                    isNull(companies.deletedAt),
                ),
            )
            .orderBy(asc(noteables.noteId), asc(companies.id));

        return rows.map((row) => ({
            noteId: ulidSchema.parse(row.noteId),
            id: ulidSchema.parse(row.id),
            teamId: ulidSchema.parse(row.teamId),
            name: row.name,
            creationSource: row.creationSource,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        }));
    }

    public async loadPeople(
        teamId: Ulid,
        noteIds: readonly Ulid[],
    ): Promise<readonly NotePersonRecord[]> {
        if (noteIds.length === 0) {
            return [];
        }

        const rows = await this.database
            .select({
                noteId: noteables.noteId,
                id: people.id,
                teamId: people.teamId,
                companyId: people.companyId,
                name: people.name,
                creationSource: people.creationSource,
                createdAt: people.createdAt,
                updatedAt: people.updatedAt,
            })
            .from(noteables)
            .innerJoin(people, eq(people.id, noteables.noteableId))
            .where(
                and(
                    inArray(noteables.noteId, noteIds),
                    eq(noteables.noteableType, "people"),
                    eq(people.teamId, teamId),
                    isNull(people.deletedAt),
                ),
            )
            .orderBy(asc(noteables.noteId), asc(people.id));

        return rows.map((row) => ({
            noteId: ulidSchema.parse(row.noteId),
            id: ulidSchema.parse(row.id),
            teamId: ulidSchema.parse(row.teamId),
            companyId:
                row.companyId === null ? null : ulidSchema.parse(row.companyId),
            name: row.name,
            creationSource: row.creationSource,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        }));
    }

    public async loadOpportunities(
        teamId: Ulid,
        noteIds: readonly Ulid[],
    ): Promise<readonly NoteOpportunityRecord[]> {
        if (noteIds.length === 0) {
            return [];
        }

        const rows = await this.database
            .select({
                noteId: noteables.noteId,
                id: opportunities.id,
                teamId: opportunities.teamId,
                companyId: opportunities.companyId,
                contactId: opportunities.contactId,
                name: opportunities.name,
                creationSource: opportunities.creationSource,
                createdAt: opportunities.createdAt,
                updatedAt: opportunities.updatedAt,
            })
            .from(noteables)
            .innerJoin(
                opportunities,
                eq(opportunities.id, noteables.noteableId),
            )
            .where(
                and(
                    inArray(noteables.noteId, noteIds),
                    eq(noteables.noteableType, "opportunity"),
                    eq(opportunities.teamId, teamId),
                    isNull(opportunities.deletedAt),
                ),
            )
            .orderBy(asc(noteables.noteId), asc(opportunities.id));

        return rows.map((row) => ({
            noteId: ulidSchema.parse(row.noteId),
            id: ulidSchema.parse(row.id),
            teamId: ulidSchema.parse(row.teamId),
            companyId:
                row.companyId === null ? null : ulidSchema.parse(row.companyId),
            contactId:
                row.contactId === null ? null : ulidSchema.parse(row.contactId),
            name: row.name,
            creationSource: row.creationSource,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        }));
    }

    public async loadRelationshipCounts(
        teamId: Ulid,
        noteIds: readonly Ulid[],
        includes: readonly NoteCountInclude[],
    ): Promise<ReadonlyMap<Ulid, NoteRelationshipCounts>> {
        const counts = initializeCounts(noteIds);

        if (noteIds.length === 0) {
            return counts;
        }

        if (includes.includes("companiesCount")) {
            const rows = await this.database
                .select({
                    noteId: noteables.noteId,
                    count: sql<number>`count(*)::integer`,
                })
                .from(noteables)
                .innerJoin(companies, eq(companies.id, noteables.noteableId))
                .where(
                    and(
                        inArray(noteables.noteId, noteIds),
                        eq(noteables.noteableType, "company"),
                        eq(companies.teamId, teamId),
                        isNull(companies.deletedAt),
                    ),
                )
                .groupBy(noteables.noteId);

            for (const row of rows) {
                setCount(counts, row.noteId, "companiesCount", row.count);
            }
        }

        if (includes.includes("peopleCount")) {
            const rows = await this.database
                .select({
                    noteId: noteables.noteId,
                    count: sql<number>`count(*)::integer`,
                })
                .from(noteables)
                .innerJoin(people, eq(people.id, noteables.noteableId))
                .where(
                    and(
                        inArray(noteables.noteId, noteIds),
                        eq(noteables.noteableType, "people"),
                        eq(people.teamId, teamId),
                        isNull(people.deletedAt),
                    ),
                )
                .groupBy(noteables.noteId);

            for (const row of rows) {
                setCount(counts, row.noteId, "peopleCount", row.count);
            }
        }

        if (includes.includes("opportunitiesCount")) {
            const rows = await this.database
                .select({
                    noteId: noteables.noteId,
                    count: sql<number>`count(*)::integer`,
                })
                .from(noteables)
                .innerJoin(
                    opportunities,
                    eq(opportunities.id, noteables.noteableId),
                )
                .where(
                    and(
                        inArray(noteables.noteId, noteIds),
                        eq(noteables.noteableType, "opportunity"),
                        eq(opportunities.teamId, teamId),
                        isNull(opportunities.deletedAt),
                    ),
                )
                .groupBy(noteables.noteId);

            for (const row of rows) {
                setCount(counts, row.noteId, "opportunitiesCount", row.count);
            }
        }

        for (const noteId of noteIds) {
            const current = counts.get(noteId) ?? {};
            counts.set(noteId, {
                ...(includes.includes("companiesCount")
                    ? { companiesCount: current.companiesCount ?? 0 }
                    : {}),
                ...(includes.includes("peopleCount")
                    ? { peopleCount: current.peopleCount ?? 0 }
                    : {}),
                ...(includes.includes("opportunitiesCount")
                    ? { opportunitiesCount: current.opportunitiesCount ?? 0 }
                    : {}),
            });
        }

        return counts;
    }
}
