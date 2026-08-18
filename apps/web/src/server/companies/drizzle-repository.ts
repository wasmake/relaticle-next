import {
    and,
    asc,
    desc,
    eq,
    ilike,
    inArray,
    isNull,
    or,
    sql,
    type SQL,
} from "drizzle-orm";

import type { ActivityWriter } from "@/server/activity/writer";
import { persistPreparedCustomFields } from "@/server/custom-fields/persist";
import { getDatabase } from "@/server/db/client";
import {
    companies,
    noteables,
    notes,
    opportunities,
    people,
    taskables,
    tasks,
    users,
} from "@/server/db/schema";
import { ulidSchema, type Ulid } from "@/server/ids";
import { userBelongsToTeam } from "@/server/tenancy/user-scope";

import type {
    CompaniesRepository,
    CreateCompanyTransaction,
    UpdateCompanyTransaction,
} from "./repository";
import type {
    CompanyCountInclude,
    CompanyListPage,
    CompanyListQuery,
    CompanyOpportunityRecord,
    CompanyPersonRecord,
    CompanyRecord,
    CompanyRelationshipCounts,
    CompanySort,
    CompanyUserRecord,
} from "./types";

type Database = ReturnType<typeof getDatabase>;

const toCompanyRecord = (
    row: typeof companies.$inferSelect,
): CompanyRecord => ({
    id: ulidSchema.parse(row.id),
    teamId: ulidSchema.parse(row.teamId),
    creatorId: row.creatorId === null ? null : ulidSchema.parse(row.creatorId),
    accountOwnerId:
        row.accountOwnerId === null
            ? null
            : ulidSchema.parse(row.accountOwnerId),
    name: row.name,
    creationSource: row.creationSource,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
});

const orderFor = (sort: CompanySort): SQL => {
    const column =
        sort.field === "name"
            ? companies.name
            : sort.field === "created_at"
              ? companies.createdAt
              : companies.updatedAt;

    return sort.direction === "asc" ? asc(column) : desc(column);
};

const initializeCounts = (
    companyIds: readonly Ulid[],
): Map<Ulid, CompanyRelationshipCounts> =>
    new Map(companyIds.map((companyId) => [companyId, {}]));

const setCount = (
    counts: Map<Ulid, CompanyRelationshipCounts>,
    companyId: string | null,
    key: keyof CompanyRelationshipCounts,
    value: number,
): void => {
    if (companyId === null) {
        return;
    }

    const id = ulidSchema.parse(companyId);
    counts.set(id, { ...counts.get(id), [key]: value });
};

export class DrizzleCompaniesRepository implements CompaniesRepository {
    public constructor(
        private readonly activity: ActivityWriter,
        private readonly database: Database = getDatabase(),
    ) {}

    public async list(
        teamId: Ulid,
        query: CompanyListQuery,
    ): Promise<CompanyListPage> {
        const conditions: SQL[] = [
            eq(companies.teamId, teamId),
            isNull(companies.deletedAt),
        ];

        if (query.filters.name !== undefined) {
            conditions.push(ilike(companies.name, `%${query.filters.name}%`));
        }

        if (query.filters.createdAfter !== undefined) {
            conditions.push(
                sql`${companies.createdAt}::date >= ${query.filters.createdAfter}::date`,
            );
        }

        if (query.filters.createdBefore !== undefined) {
            conditions.push(
                sql`${companies.createdAt}::date <= ${query.filters.createdBefore}::date`,
            );
        }

        const where = and(...conditions);
        const [rows, totalRows] = await Promise.all([
            this.database
                .select()
                .from(companies)
                .where(where)
                .orderBy(...query.sorts.map(orderFor), asc(companies.id))
                .limit(query.perPage)
                .offset((query.page - 1) * query.perPage),
            this.database
                .select({ total: sql<number>`count(*)::integer` })
                .from(companies)
                .where(where),
        ]);

        return {
            records: rows.map(toCompanyRecord),
            total: totalRows[0]?.total ?? 0,
        };
    }

    public async find(
        teamId: Ulid,
        companyId: Ulid,
    ): Promise<CompanyRecord | undefined> {
        const [company] = await this.database
            .select()
            .from(companies)
            .where(
                and(
                    eq(companies.teamId, teamId),
                    eq(companies.id, companyId),
                    isNull(companies.deletedAt),
                ),
            )
            .limit(1);

        return company === undefined ? undefined : toCompanyRecord(company);
    }

    public async create(
        input: CreateCompanyTransaction,
    ): Promise<CompanyRecord> {
        return this.database.transaction(async (transaction) => {
            const batchUuid = this.activity.batchUuid();
            const [created] = await transaction
                .insert(companies)
                .values({
                    id: input.id,
                    teamId: input.teamId,
                    creatorId: input.creatorId,
                    accountOwnerId: null,
                    name: input.name,
                    creationSource: input.creationSource,
                    createdAt: input.occurredAt,
                    updatedAt: input.occurredAt,
                    deletedAt: null,
                })
                .returning();

            if (created === undefined) {
                throw new Error("Company insert did not return the created row.");
            }

            await this.activity.writeNative(transaction, {
                teamId: input.teamId,
                subjectType: "company",
                subjectId: input.id,
                causerId: input.creatorId,
                event: "created",
                attributes: { name: input.name },
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

            return toCompanyRecord(created);
        });
    }

    public async update(
        input: UpdateCompanyTransaction,
        causerId: Ulid,
    ): Promise<CompanyRecord | undefined> {
        return this.database.transaction(async (transaction) => {
            const batchUuid = this.activity.batchUuid();
            const [existing] = await transaction
                .select()
                .from(companies)
                .where(
                    and(
                        eq(companies.teamId, input.teamId),
                        eq(companies.id, input.id),
                        isNull(companies.deletedAt),
                    ),
                )
                .limit(1)
                .for("update");

            if (existing === undefined) {
                return undefined;
            }

            const [updated] = await transaction
                .update(companies)
                .set({
                    updatedAt: input.occurredAt,
                    ...(input.name === undefined ? {} : { name: input.name }),
                })
                .where(
                    and(
                        eq(companies.teamId, input.teamId),
                        eq(companies.id, input.id),
                        isNull(companies.deletedAt),
                    ),
                )
                .returning();

            if (updated === undefined) {
                return undefined;
            }

            const nameChanged = existing.name !== updated.name;

            await this.activity.writeNative(transaction, {
                teamId: input.teamId,
                subjectType: "company",
                subjectId: input.id,
                causerId,
                event: "updated",
                attributes: nameChanged ? { name: updated.name } : {},
                old: nameChanged ? { name: existing.name } : {},
                batchUuid,
                occurredAt: input.occurredAt,
            });

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

            return toCompanyRecord(updated);
        });
    }

    public async softDelete(
        teamId: Ulid,
        companyId: Ulid,
        occurredAt: Date,
        causerId: Ulid,
    ): Promise<boolean> {
        return this.database.transaction(async (transaction) => {
            const [deleted] = await transaction
                .update(companies)
                .set({ deletedAt: occurredAt, updatedAt: occurredAt })
                .where(
                    and(
                        eq(companies.teamId, teamId),
                        eq(companies.id, companyId),
                        isNull(companies.deletedAt),
                    ),
                )
                .returning({ id: companies.id });

            if (deleted === undefined) {
                return false;
            }

            await this.activity.writeNative(transaction, {
                teamId,
                subjectType: "company",
                subjectId: companyId,
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
        companyRecords: readonly CompanyRecord[],
        relationships: readonly ("creator" | "accountOwner")[],
    ): Promise<readonly CompanyUserRecord[]> {
        if (companyRecords.length === 0 || relationships.length === 0) {
            return [];
        }

        const relationshipConditions = relationships.map((relationship) =>
            relationship === "creator"
                ? eq(companies.creatorId, users.id)
                : eq(companies.accountOwnerId, users.id),
        );
        const relationshipCondition = or(...relationshipConditions);

        if (relationshipCondition === undefined) {
            return [];
        }

        const rows = await this.database
            .selectDistinct({ id: users.id, name: users.name, email: users.email })
            .from(users)
            .innerJoin(companies, relationshipCondition)
            .where(
                and(
                    eq(companies.teamId, teamId),
                    inArray(
                        companies.id,
                        companyRecords.map((company) => company.id),
                    ),
                    isNull(companies.deletedAt),
                    userBelongsToTeam(users.id, teamId),
                ),
            );

        return rows.map((row) => ({
            id: ulidSchema.parse(row.id),
            name: row.name,
            email: row.email,
        }));
    }

    public async loadPeople(
        teamId: Ulid,
        companyIds: readonly Ulid[],
    ): Promise<readonly CompanyPersonRecord[]> {
        if (companyIds.length === 0) {
            return [];
        }

        const rows = await this.database
            .select()
            .from(people)
            .where(
                and(
                    eq(people.teamId, teamId),
                    inArray(people.companyId, companyIds),
                    isNull(people.deletedAt),
                ),
            )
            .orderBy(asc(people.id));

        return rows.map((row) => ({
            id: ulidSchema.parse(row.id),
            teamId: ulidSchema.parse(row.teamId),
            companyId: ulidSchema.parse(row.companyId),
            name: row.name,
            creationSource: row.creationSource,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        }));
    }

    public async loadOpportunities(
        teamId: Ulid,
        companyIds: readonly Ulid[],
    ): Promise<readonly CompanyOpportunityRecord[]> {
        if (companyIds.length === 0) {
            return [];
        }

        const rows = await this.database
            .select()
            .from(opportunities)
            .where(
                and(
                    eq(opportunities.teamId, teamId),
                    inArray(opportunities.companyId, companyIds),
                    isNull(opportunities.deletedAt),
                ),
            )
            .orderBy(asc(opportunities.id));

        return rows.map((row) => ({
            id: ulidSchema.parse(row.id),
            teamId: ulidSchema.parse(row.teamId),
            companyId: ulidSchema.parse(row.companyId),
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
        companyIds: readonly Ulid[],
        includes: readonly CompanyCountInclude[],
    ): Promise<ReadonlyMap<Ulid, CompanyRelationshipCounts>> {
        const counts = initializeCounts(companyIds);

        if (companyIds.length === 0) {
            return counts;
        }

        if (includes.includes("peopleCount")) {
            const rows = await this.database
                .select({
                    companyId: people.companyId,
                    count: sql<number>`count(*)::integer`,
                })
                .from(people)
                .where(
                    and(
                        eq(people.teamId, teamId),
                        inArray(people.companyId, companyIds),
                        isNull(people.deletedAt),
                    ),
                )
                .groupBy(people.companyId);

            for (const row of rows) {
                setCount(counts, row.companyId, "peopleCount", row.count);
            }
        }

        if (includes.includes("opportunitiesCount")) {
            const rows = await this.database
                .select({
                    companyId: opportunities.companyId,
                    count: sql<number>`count(*)::integer`,
                })
                .from(opportunities)
                .where(
                    and(
                        eq(opportunities.teamId, teamId),
                        inArray(opportunities.companyId, companyIds),
                        isNull(opportunities.deletedAt),
                    ),
                )
                .groupBy(opportunities.companyId);

            for (const row of rows) {
                setCount(
                    counts,
                    row.companyId,
                    "opportunitiesCount",
                    row.count,
                );
            }
        }

        if (includes.includes("tasksCount")) {
            const rows = await this.database
                .select({
                    companyId: taskables.taskableId,
                    count: sql<number>`count(*)::integer`,
                })
                .from(taskables)
                .innerJoin(tasks, eq(tasks.id, taskables.taskId))
                .where(
                    and(
                        eq(tasks.teamId, teamId),
                        eq(taskables.taskableType, "company"),
                        inArray(taskables.taskableId, companyIds),
                        isNull(tasks.deletedAt),
                    ),
                )
                .groupBy(taskables.taskableId);

            for (const row of rows) {
                setCount(counts, row.companyId, "tasksCount", row.count);
            }
        }

        if (includes.includes("notesCount")) {
            const rows = await this.database
                .select({
                    companyId: noteables.noteableId,
                    count: sql<number>`count(*)::integer`,
                })
                .from(noteables)
                .innerJoin(notes, eq(notes.id, noteables.noteId))
                .where(
                    and(
                        eq(notes.teamId, teamId),
                        eq(noteables.noteableType, "company"),
                        inArray(noteables.noteableId, companyIds),
                        isNull(notes.deletedAt),
                    ),
                )
                .groupBy(noteables.noteableId);

            for (const row of rows) {
                setCount(counts, row.companyId, "notesCount", row.count);
            }
        }

        for (const companyId of companyIds) {
            const current = counts.get(companyId) ?? {};
            counts.set(companyId, {
                ...(includes.includes("peopleCount")
                    ? { peopleCount: current.peopleCount ?? 0 }
                    : {}),
                ...(includes.includes("opportunitiesCount")
                    ? { opportunitiesCount: current.opportunitiesCount ?? 0 }
                    : {}),
                ...(includes.includes("tasksCount")
                    ? { tasksCount: current.tasksCount ?? 0 }
                    : {}),
                ...(includes.includes("notesCount")
                    ? { notesCount: current.notesCount ?? 0 }
                    : {}),
            });
        }

        return counts;
    }
}
