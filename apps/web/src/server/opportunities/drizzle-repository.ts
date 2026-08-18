import {
    and,
    asc,
    desc,
    eq,
    exists,
    ilike,
    inArray,
    isNull,
    notExists,
    or,
    sql,
    type SQL,
} from "drizzle-orm";

import { ApiBadRequestError } from "@/server/api/errors";
import type { ActivityWriter } from "@/server/activity/writer";
import { persistPreparedCustomFields } from "@/server/custom-fields/persist";
import { getDatabase } from "@/server/db/client";
import {
    activityLog,
    companies,
    customFields,
    customFieldValues,
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
    CreateOpportunityTransaction,
    OpportunitiesRepository,
    OpportunityForeignKey,
    OpportunityForeignKeys,
    UpdateOpportunityTransaction,
} from "./repository";
import type {
    CustomFieldFilterOperator,
    OpportunityCompanyRecord,
    OpportunityContactRecord,
    OpportunityCountInclude,
    OpportunityCustomFieldFilter,
    OpportunityListPage,
    OpportunityListQuery,
    OpportunityRecord,
    OpportunityRelationshipCounts,
    OpportunitySort,
    OpportunityUserRecord,
} from "./types";

type Database = ReturnType<typeof getDatabase>;

type QueryCustomFieldDefinition = Readonly<{
    id: Ulid;
    code: string;
    type: string;
}>;

const nativeSorts = new Set(["name", "created_at", "updated_at"]);
const stringOperators = new Set<CustomFieldFilterOperator>(["eq", "contains"]);
const comparisonOperators = new Set<CustomFieldFilterOperator>([
    "eq",
    "gt",
    "gte",
    "lt",
    "lte",
]);
const booleanOperators = new Set<CustomFieldFilterOperator>(["eq"]);
const selectOperators = new Set<CustomFieldFilterOperator>(["eq", "in"]);
const multiValueOperators = new Set<CustomFieldFilterOperator>(["has_any"]);

const toOpportunityRecord = (
    row: typeof opportunities.$inferSelect,
): OpportunityRecord => ({
    id: ulidSchema.parse(row.id),
    teamId: ulidSchema.parse(row.teamId),
    creatorId: row.creatorId === null ? null : ulidSchema.parse(row.creatorId),
    companyId: row.companyId === null ? null : ulidSchema.parse(row.companyId),
    contactId: row.contactId === null ? null : ulidSchema.parse(row.contactId),
    name: row.name,
    creationSource: row.creationSource,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
});

const operatorsForType = (
    type: string,
): ReadonlySet<CustomFieldFilterOperator> => {
    if (["text", "email", "phone", "link"].includes(type)) {
        return stringOperators;
    }

    if (["currency", "number", "date", "date-time"].includes(type)) {
        return comparisonOperators;
    }

    if (["checkbox", "toggle"].includes(type)) {
        return booleanOperators;
    }

    if (["select", "radio", "toggle-buttons"].includes(type)) {
        return selectOperators;
    }

    if (["multi-select", "checkbox-list", "tags-input"].includes(type)) {
        return multiValueOperators;
    }

    return new Set();
};

const isEncrypted = (settings: unknown): boolean =>
    typeof settings === "object" &&
    settings !== null &&
    !Array.isArray(settings) &&
    "encrypted" in settings &&
    settings.encrypted === true;

const customFieldColumn = (type: string): SQL => {
    if (type === "text") {
        return sql`${customFieldValues.textValue}`;
    }

    if (type === "number") {
        return sql`${customFieldValues.integerValue}`;
    }

    if (["email", "phone", "link"].includes(type)) {
        return sql`${customFieldValues.jsonValue}::text`;
    }

    if (["checkbox", "toggle"].includes(type)) {
        return sql`${customFieldValues.booleanValue}`;
    }

    if (["radio", "toggle-buttons", "select"].includes(type)) {
        return sql`${customFieldValues.stringValue}`;
    }

    if (type === "currency") {
        return sql`${customFieldValues.floatValue}`;
    }

    if (type === "date") {
        return sql`${customFieldValues.dateValue}`;
    }

    if (type === "date-time") {
        return sql`${customFieldValues.datetimeValue}`;
    }

    return sql`${customFieldValues.jsonValue}::text`;
};

const scalarValue = (
    definition: QueryCustomFieldDefinition,
    filter: OpportunityCustomFieldFilter,
): string | number | bigint | boolean | Date => {
    const value = Array.isArray(filter.value) ? filter.value[0] : filter.value;

    if (value === undefined) {
        throw new ApiBadRequestError(
            `Custom field filter ${definition.code}.${filter.operator} requires a value.`,
        );
    }

    if (definition.type === "number") {
        if (!/^-?[0-9]+$/u.test(value)) {
            throw new ApiBadRequestError(
                `Custom field filter ${definition.code}.${filter.operator} requires an integer.`,
            );
        }

        return BigInt(value);
    }

    if (definition.type === "currency") {
        const parsed = Number(value);

        if (!Number.isFinite(parsed)) {
            throw new ApiBadRequestError(
                `Custom field filter ${definition.code}.${filter.operator} requires a number.`,
            );
        }

        return parsed;
    }

    if (["checkbox", "toggle"].includes(definition.type)) {
        if (value === "true" || value === "1") {
            return true;
        }

        if (value === "false" || value === "0") {
            return false;
        }

        throw new ApiBadRequestError(
            `Custom field filter ${definition.code}.${filter.operator} requires a boolean.`,
        );
    }

    if (definition.type === "date") {
        if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
            throw new ApiBadRequestError(
                `Custom field filter ${definition.code}.${filter.operator} requires a date.`,
            );
        }

        return value;
    }

    if (definition.type === "date-time") {
        const parsed = new Date(value);

        if (Number.isNaN(parsed.getTime())) {
            throw new ApiBadRequestError(
                `Custom field filter ${definition.code}.${filter.operator} requires a date-time.`,
            );
        }

        return parsed;
    }

    return value;
};

const comparisonFor = (
    definition: QueryCustomFieldDefinition,
    filter: OpportunityCustomFieldFilter,
): SQL => {
    const column = customFieldColumn(definition.type);

    if (filter.operator === "contains") {
        const value = scalarValue(definition, filter).toString();
        const escaped = value.replace(/[\\%_]/gu, "\\$&");

        return sql`${column} ILIKE ${`%${escaped}%`}`;
    }

    if (filter.operator === "in") {
        const values = Array.isArray(filter.value)
            ? filter.value
            : [filter.value];

        return sql`${column} IN (${sql.join(
            values.map((value) => sql`${value}`),
            sql`, `,
        )})`;
    }

    if (filter.operator === "has_any") {
        const values = Array.isArray(filter.value)
            ? filter.value
            : [filter.value];
        const comparisons = values.map(
            (value) =>
                sql`${customFieldValues.jsonValue}::jsonb @> ${JSON.stringify([value])}::jsonb`,
        );

        return or(...comparisons) ?? sql`false`;
    }

    const operator =
        filter.operator === "eq"
            ? sql`=`
            : filter.operator === "gt"
              ? sql`>`
              : filter.operator === "gte"
                ? sql`>=`
                : filter.operator === "lt"
                  ? sql`<`
                  : sql`<=`;

    return sql`${column} ${operator} ${scalarValue(definition, filter)}`;
};

const orderFor = (
    sort: OpportunitySort,
    definitions: ReadonlyMap<string, QueryCustomFieldDefinition>,
): SQL => {
    const column =
        sort.field === "name"
            ? opportunities.name
            : sort.field === "created_at"
              ? opportunities.createdAt
              : sort.field === "updated_at"
                ? opportunities.updatedAt
                : undefined;

    if (column !== undefined) {
        return sort.direction === "asc" ? asc(column) : desc(column);
    }

    const definition = definitions.get(sort.field);

    if (definition === undefined) {
        throw new ApiBadRequestError(
            `Requested sort ${sort.field} is not allowed.`,
        );
    }

    const expression = sql`(
        SELECT ${customFieldColumn(definition.type)}
        FROM ${customFieldValues}
        WHERE ${customFieldValues.tenantId} = ${opportunities.teamId}
          AND ${customFieldValues.entityType} = 'opportunity'
          AND ${customFieldValues.entityId} = ${opportunities.id}
          AND ${customFieldValues.customFieldId} = ${definition.id}
        LIMIT 1
    )`;

    return sort.direction === "asc" ? asc(expression) : desc(expression);
};

const initializeCounts = (
    opportunityIds: readonly Ulid[],
): Map<Ulid, OpportunityRelationshipCounts> =>
    new Map(opportunityIds.map((opportunityId) => [opportunityId, {}]));

const setCount = (
    counts: Map<Ulid, OpportunityRelationshipCounts>,
    opportunityId: string,
    key: keyof OpportunityRelationshipCounts,
    value: number,
): void => {
    const id = ulidSchema.parse(opportunityId);
    counts.set(id, { ...counts.get(id), [key]: value });
};

export class DrizzleOpportunitiesRepository implements OpportunitiesRepository {
    public constructor(
        private readonly activity: ActivityWriter,
        private readonly database: Database = getDatabase(),
    ) {}

    public async list(
        teamId: Ulid,
        query: OpportunityListQuery,
    ): Promise<OpportunityListPage> {
        const definitions = await this.loadQueryCustomFields(teamId, query);
        const conditions: SQL[] = [
            eq(opportunities.teamId, teamId),
            isNull(opportunities.deletedAt),
        ];

        if (query.filters.name !== undefined) {
            conditions.push(
                ilike(opportunities.name, `%${query.filters.name}%`),
            );
        }

        if (query.filters.companyId !== undefined) {
            conditions.push(
                eq(opportunities.companyId, query.filters.companyId),
            );
        }

        if (query.filters.contactId !== undefined) {
            conditions.push(
                eq(opportunities.contactId, query.filters.contactId),
            );
        }

        if (query.filters.createdAfter !== undefined) {
            conditions.push(
                sql`${opportunities.createdAt}::date >= ${query.filters.createdAfter}::date`,
            );
        }

        if (query.filters.createdBefore !== undefined) {
            conditions.push(
                sql`${opportunities.createdAt}::date <= ${query.filters.createdBefore}::date`,
            );
        }

        if (query.filters.staleDays !== undefined) {
            const staleSince = new Date(
                Date.now() - query.filters.staleDays * 24 * 60 * 60 * 1000,
            );
            conditions.push(
                notExists(
                    this.database
                        .select({ value: sql`1` })
                        .from(activityLog)
                        .where(
                            and(
                                eq(activityLog.teamId, teamId),
                                eq(activityLog.subjectType, "opportunity"),
                                eq(activityLog.subjectId, opportunities.id),
                                sql`${activityLog.createdAt} >= ${staleSince}`,
                            ),
                        ),
                ),
            );
        }

        for (const filter of query.filters.customFields) {
            const definition = definitions.get(filter.code);

            if (definition === undefined) {
                throw new ApiBadRequestError(
                    `Requested custom field filter ${filter.code} is not allowed.`,
                );
            }

            conditions.push(
                exists(
                    this.database
                        .select({ value: sql`1` })
                        .from(customFieldValues)
                        .where(
                            and(
                                eq(customFieldValues.tenantId, teamId),
                                eq(customFieldValues.entityType, "opportunity"),
                                eq(
                                    customFieldValues.entityId,
                                    opportunities.id,
                                ),
                                eq(
                                    customFieldValues.customFieldId,
                                    definition.id,
                                ),
                                comparisonFor(definition, filter),
                            ),
                        ),
                ),
            );
        }

        const where = and(...conditions);
        const [rows, totalRows] = await Promise.all([
            this.database
                .select()
                .from(opportunities)
                .where(where)
                .orderBy(
                    ...query.sorts.map((sort) => orderFor(sort, definitions)),
                    asc(opportunities.id),
                )
                .limit(query.perPage)
                .offset((query.page - 1) * query.perPage),
            this.database
                .select({ total: sql<number>`count(*)::integer` })
                .from(opportunities)
                .where(where),
        ]);

        return {
            records: rows.map(toOpportunityRecord),
            total: totalRows[0]?.total ?? 0,
        };
    }

    public async find(
        teamId: Ulid,
        opportunityId: Ulid,
    ): Promise<OpportunityRecord | undefined> {
        const [opportunity] = await this.database
            .select()
            .from(opportunities)
            .where(
                and(
                    eq(opportunities.teamId, teamId),
                    eq(opportunities.id, opportunityId),
                    isNull(opportunities.deletedAt),
                ),
            )
            .limit(1);

        return opportunity === undefined
            ? undefined
            : toOpportunityRecord(opportunity);
    }

    public async invalidForeignKeys(
        teamId: Ulid,
        foreignKeys: OpportunityForeignKeys,
    ): Promise<readonly OpportunityForeignKey[]> {
        const checks: Array<Promise<OpportunityForeignKey | undefined>> = [];

        if (
            foreignKeys.companyId !== undefined &&
            foreignKeys.companyId !== null
        ) {
            checks.push(
                this.database
                    .select({ id: companies.id })
                    .from(companies)
                    .where(
                        and(
                            eq(companies.teamId, teamId),
                            eq(companies.id, foreignKeys.companyId),
                            isNull(companies.deletedAt),
                        ),
                    )
                    .limit(1)
                    .then(([row]) =>
                        row === undefined ? "company_id" : undefined,
                    ),
            );
        }

        if (
            foreignKeys.contactId !== undefined &&
            foreignKeys.contactId !== null
        ) {
            checks.push(
                this.database
                    .select({ id: people.id })
                    .from(people)
                    .where(
                        and(
                            eq(people.teamId, teamId),
                            eq(people.id, foreignKeys.contactId),
                            isNull(people.deletedAt),
                        ),
                    )
                    .limit(1)
                    .then(([row]) =>
                        row === undefined ? "contact_id" : undefined,
                    ),
            );
        }

        return (await Promise.all(checks)).filter(
            (field): field is OpportunityForeignKey => field !== undefined,
        );
    }

    public async create(
        input: CreateOpportunityTransaction,
    ): Promise<OpportunityRecord> {
        return this.database.transaction(async (transaction) => {
            const batchUuid = this.activity.batchUuid();
            const [created] = await transaction
                .insert(opportunities)
                .values({
                    id: input.id,
                    teamId: input.teamId,
                    creatorId: input.creatorId,
                    companyId: input.companyId,
                    contactId: input.contactId,
                    name: input.name,
                    creationSource: input.creationSource,
                    orderColumn: sql`(
                        select coalesce(max(${opportunities.orderColumn}), 0) + 1
                        from ${opportunities}
                        where ${opportunities.teamId} = ${input.teamId}
                          and ${opportunities.deletedAt} is null
                    )`,
                    createdAt: input.occurredAt,
                    updatedAt: input.occurredAt,
                    deletedAt: null,
                })
                .returning();

            if (created === undefined) {
                throw new Error(
                    "Opportunity insert did not return the created row.",
                );
            }

            await this.activity.writeNative(transaction, {
                teamId: input.teamId,
                subjectType: "opportunity",
                subjectId: input.id,
                causerId: input.creatorId,
                event: "created",
                attributes: {
                    name: input.name,
                    company_id: input.companyId,
                    contact_id: input.contactId,
                },
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

            return toOpportunityRecord(created);
        });
    }

    public async update(
        input: UpdateOpportunityTransaction,
        causerId: Ulid,
    ): Promise<OpportunityRecord | undefined> {
        return this.database.transaction(async (transaction) => {
            const batchUuid = this.activity.batchUuid();
            const [existing] = await transaction
                .select()
                .from(opportunities)
                .where(
                    and(
                        eq(opportunities.teamId, input.teamId),
                        eq(opportunities.id, input.id),
                        isNull(opportunities.deletedAt),
                    ),
                )
                .limit(1)
                .for("update");

            if (existing === undefined) {
                return undefined;
            }

            const [updated] = await transaction
                .update(opportunities)
                .set({
                    updatedAt: input.occurredAt,
                    ...(input.name === undefined ? {} : { name: input.name }),
                    ...(input.companyId === undefined
                        ? {}
                        : { companyId: input.companyId }),
                    ...(input.contactId === undefined
                        ? {}
                        : { contactId: input.contactId }),
                })
                .where(
                    and(
                        eq(opportunities.teamId, input.teamId),
                        eq(opportunities.id, input.id),
                        isNull(opportunities.deletedAt),
                    ),
                )
                .returning();

            if (updated === undefined) {
                return undefined;
            }

            const attributes: Record<string, string | null> = {};
            const old: Record<string, string | null> = {};

            if (existing.name !== updated.name) {
                attributes.name = updated.name;
                old.name = existing.name;
            }
            if (existing.companyId !== updated.companyId) {
                attributes.company_id = updated.companyId;
                old.company_id = existing.companyId;
            }
            if (existing.contactId !== updated.contactId) {
                attributes.contact_id = updated.contactId;
                old.contact_id = existing.contactId;
            }

            await this.activity.writeNative(transaction, {
                teamId: input.teamId,
                subjectType: "opportunity",
                subjectId: input.id,
                causerId,
                event: "updated",
                attributes,
                old,
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

            return toOpportunityRecord(updated);
        });
    }

    public async softDelete(
        teamId: Ulid,
        opportunityId: Ulid,
        occurredAt: Date,
        causerId: Ulid,
    ): Promise<boolean> {
        return this.database.transaction(async (transaction) => {
            const [deleted] = await transaction
                .update(opportunities)
                .set({ deletedAt: occurredAt, updatedAt: occurredAt })
                .where(
                    and(
                        eq(opportunities.teamId, teamId),
                        eq(opportunities.id, opportunityId),
                        isNull(opportunities.deletedAt),
                    ),
                )
                .returning({ id: opportunities.id });

            if (deleted === undefined) {
                return false;
            }

            await this.activity.writeNative(transaction, {
                teamId,
                subjectType: "opportunity",
                subjectId: opportunityId,
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
        opportunityRecords: readonly OpportunityRecord[],
    ): Promise<readonly OpportunityUserRecord[]> {
        const creatorIds = opportunityRecords
            .map((opportunity) => opportunity.creatorId)
            .filter((id): id is Ulid => id !== null);

        if (creatorIds.length === 0) {
            return [];
        }

        const rows = await this.database
            .selectDistinct({
                id: users.id,
                name: users.name,
                email: users.email,
            })
            .from(users)
            .where(
                and(
                    inArray(users.id, creatorIds),
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
        companyIds: readonly Ulid[],
    ): Promise<readonly OpportunityCompanyRecord[]> {
        if (companyIds.length === 0) {
            return [];
        }

        const rows = await this.database
            .select()
            .from(companies)
            .where(
                and(
                    eq(companies.teamId, teamId),
                    inArray(companies.id, companyIds),
                    isNull(companies.deletedAt),
                ),
            );

        return rows.map((row) => ({
            id: ulidSchema.parse(row.id),
            teamId: ulidSchema.parse(row.teamId),
            name: row.name,
            creationSource: row.creationSource,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        }));
    }

    public async loadContacts(
        teamId: Ulid,
        contactIds: readonly Ulid[],
    ): Promise<readonly OpportunityContactRecord[]> {
        if (contactIds.length === 0) {
            return [];
        }

        const rows = await this.database
            .select()
            .from(people)
            .where(
                and(
                    eq(people.teamId, teamId),
                    inArray(people.id, contactIds),
                    isNull(people.deletedAt),
                ),
            );

        return rows.map((row) => ({
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

    public async loadRelationshipCounts(
        teamId: Ulid,
        opportunityIds: readonly Ulid[],
        includes: readonly OpportunityCountInclude[],
    ): Promise<ReadonlyMap<Ulid, OpportunityRelationshipCounts>> {
        const counts = initializeCounts(opportunityIds);

        if (opportunityIds.length === 0) {
            return counts;
        }

        if (includes.includes("tasksCount")) {
            const rows = await this.database
                .select({
                    opportunityId: taskables.taskableId,
                    count: sql<number>`count(*)::integer`,
                })
                .from(taskables)
                .innerJoin(tasks, eq(tasks.id, taskables.taskId))
                .where(
                    and(
                        eq(tasks.teamId, teamId),
                        eq(taskables.taskableType, "opportunity"),
                        inArray(taskables.taskableId, opportunityIds),
                        isNull(tasks.deletedAt),
                    ),
                )
                .groupBy(taskables.taskableId);

            for (const row of rows) {
                setCount(counts, row.opportunityId, "tasksCount", row.count);
            }
        }

        if (includes.includes("notesCount")) {
            const rows = await this.database
                .select({
                    opportunityId: noteables.noteableId,
                    count: sql<number>`count(*)::integer`,
                })
                .from(noteables)
                .innerJoin(notes, eq(notes.id, noteables.noteId))
                .where(
                    and(
                        eq(notes.teamId, teamId),
                        eq(noteables.noteableType, "opportunity"),
                        inArray(noteables.noteableId, opportunityIds),
                        isNull(notes.deletedAt),
                    ),
                )
                .groupBy(noteables.noteableId);

            for (const row of rows) {
                setCount(counts, row.opportunityId, "notesCount", row.count);
            }
        }

        for (const opportunityId of opportunityIds) {
            const current = counts.get(opportunityId) ?? {};
            counts.set(opportunityId, {
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

    private async loadQueryCustomFields(
        teamId: Ulid,
        query: OpportunityListQuery,
    ): Promise<ReadonlyMap<string, QueryCustomFieldDefinition>> {
        const requestedFilterCodes = query.filters.customFields.map(
            (filter) => filter.code,
        );
        const requestedSortCodes = query.sorts
            .map((sort) => sort.field)
            .filter((field) => !nativeSorts.has(field));
        const requestedCodes = [
            ...new Set([...requestedFilterCodes, ...requestedSortCodes]),
        ];

        if (requestedCodes.length === 0) {
            return new Map();
        }

        const rows = await this.database
            .select({
                id: customFields.id,
                code: customFields.code,
                type: customFields.type,
                settings: customFields.settings,
            })
            .from(customFields)
            .where(
                and(
                    eq(customFields.tenantId, teamId),
                    eq(customFields.entityType, "opportunity"),
                    eq(customFields.active, true),
                    inArray(customFields.code, requestedCodes),
                ),
            );
        const definitions = new Map<string, QueryCustomFieldDefinition>();

        for (const row of rows) {
            if (
                isEncrypted(row.settings) ||
                operatorsForType(row.type).size === 0
            ) {
                continue;
            }

            definitions.set(row.code, {
                id: ulidSchema.parse(row.id),
                code: row.code,
                type: row.type,
            });
        }

        for (const filter of query.filters.customFields) {
            const definition = definitions.get(filter.code);

            if (
                definition === undefined ||
                !operatorsForType(definition.type).has(filter.operator)
            ) {
                throw new ApiBadRequestError(
                    `Requested custom field filter ${filter.code}.${filter.operator} is not allowed.`,
                );
            }
        }

        for (const code of requestedSortCodes) {
            if (!definitions.has(code)) {
                throw new ApiBadRequestError(
                    `Requested sort ${code} is not allowed.`,
                );
            }
        }

        return definitions;
    }
}
