import {
    and,
    asc,
    desc,
    eq,
    getTableColumns,
    ilike,
    inArray,
    isNull,
    or,
    sql,
    type SQL,
} from "drizzle-orm";

import { ApiBadRequestError } from "@/server/api/errors";
import type { ActivityWriter } from "@/server/activity/writer";
import { persistPreparedCustomFields } from "@/server/custom-fields/persist";
import { customFieldStorageColumnForType } from "@/server/custom-fields/storage";
import type { CustomFieldType } from "@/server/custom-fields/types";
import { getDatabase } from "@/server/db/client";
import {
    companies,
    customFields,
    customFieldValues,
    noteables,
    notes,
    people,
    taskables,
    tasks,
    users,
} from "@/server/db/schema";
import { ulidSchema, type Ulid } from "@/server/ids";
import { userBelongsToTeam } from "@/server/tenancy/user-scope";

import { encodePeopleCursor } from "./query";
import type {
    CreatePeopleTransaction,
    PeopleRepository,
    UpdatePeopleTransaction,
} from "./repository";
import type {
    PeopleCompanyRecord,
    PeopleCountInclude,
    PeopleCursor,
    PeopleCursorValue,
    PeopleCustomFieldFilter,
    PeopleCustomFieldFilterOperator,
    PeopleListPage,
    PeopleListQuery,
    PeopleRecord,
    PeopleRelationshipCounts,
    PeopleSort,
    PeopleUserRecord,
    SortDirection,
} from "./types";

type Database = ReturnType<typeof getDatabase>;

const supportedCustomFieldTypes = [
    "text",
    "number",
    "email",
    "phone",
    "link",
    "checkbox",
    "checkbox-list",
    "radio",
    "tags-input",
    "toggle",
    "toggle-buttons",
    "currency",
    "date",
    "date-time",
    "select",
    "multi-select",
] as const satisfies readonly CustomFieldType[];

type FilterableCustomFieldType = (typeof supportedCustomFieldTypes)[number];

type FilterableCustomField = Readonly<{
    id: Ulid;
    code: string;
    type: FilterableCustomFieldType;
}>;

type SortExpression = Readonly<{
    expression: SQL;
    direction: SortDirection;
}>;

type CursorRow = typeof people.$inferSelect &
    Readonly<{ cursorValues: unknown }>;

const nativeSortFields = new Set(["name", "created_at", "updated_at"]);
const numericOperators = new Set<PeopleCustomFieldFilterOperator>([
    "eq",
    "gt",
    "gte",
    "lt",
    "lte",
]);
const stringOperators = new Set<PeopleCustomFieldFilterOperator>([
    "eq",
    "contains",
]);
const booleanOperators = new Set<PeopleCustomFieldFilterOperator>(["eq"]);
const choiceOperators = new Set<PeopleCustomFieldFilterOperator>(["eq", "in"]);
const multiOperators = new Set<PeopleCustomFieldFilterOperator>(["has_any"]);

const toPeopleRecord = (row: typeof people.$inferSelect): PeopleRecord => ({
    id: ulidSchema.parse(row.id),
    teamId: ulidSchema.parse(row.teamId),
    creatorId: row.creatorId === null ? null : ulidSchema.parse(row.creatorId),
    companyId: row.companyId === null ? null : ulidSchema.parse(row.companyId),
    name: row.name,
    creationSource: row.creationSource,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
});

const operatorsFor = (
    type: FilterableCustomFieldType,
): ReadonlySet<PeopleCustomFieldFilterOperator> => {
    if (["text", "email", "phone", "link"].includes(type)) {
        return stringOperators;
    }

    if (["number", "currency", "date", "date-time"].includes(type)) {
        return numericOperators;
    }

    if (["checkbox", "toggle"].includes(type)) {
        return booleanOperators;
    }

    if (["select", "radio", "toggle-buttons"].includes(type)) {
        return choiceOperators;
    }

    return multiOperators;
};

const customValueColumn = (type: FilterableCustomFieldType) => {
    const column = customFieldStorageColumnForType(type);

    return customFieldValues[column];
};

const customValueExpression = (
    teamId: Ulid,
    field: FilterableCustomField,
): SQL => {
    const column = customValueColumn(field.type);
    const selected = [
        "email",
        "phone",
        "link",
        "checkbox-list",
        "tags-input",
        "multi-select",
    ].includes(field.type)
        ? sql`${column}::text`
        : sql`${column}`;

    return sql`(
        select ${selected}
        from ${customFieldValues}
        where ${customFieldValues.tenantId} = ${teamId}
          and ${customFieldValues.entityType} = 'people'
          and ${customFieldValues.entityId} = ${people.id}
          and ${customFieldValues.customFieldId} = ${field.id}
        limit 1
    )`;
};

const sortExpression = (
    teamId: Ulid,
    sort: PeopleSort,
    fieldsByCode: ReadonlyMap<string, FilterableCustomField>,
): SortExpression => {
    if (sort.field === "name") {
        return { expression: sql`${people.name}`, direction: sort.direction };
    }

    if (sort.field === "created_at") {
        return {
            expression: sql`${people.createdAt}`,
            direction: sort.direction,
        };
    }

    if (sort.field === "updated_at") {
        return {
            expression: sql`${people.updatedAt}`,
            direction: sort.direction,
        };
    }

    const field = fieldsByCode.get(sort.field);

    if (field === undefined) {
        throw new ApiBadRequestError(
            `Requested sort ${sort.field} is not allowed.`,
        );
    }

    return {
        expression: customValueExpression(teamId, field),
        direction: sort.direction,
    };
};

const scalarOperand = (filter: PeopleCustomFieldFilter): boolean | string => {
    if (typeof filter.operand === "object") {
        throw new ApiBadRequestError(
            `Custom field filter ${filter.code}.${filter.operator} requires one value.`,
        );
    }

    return filter.operand;
};

const arrayOperand = (
    filter: PeopleCustomFieldFilter,
): readonly (boolean | string)[] =>
    typeof filter.operand === "object" ? filter.operand : [filter.operand];

const stringOperand = (
    filter: PeopleCustomFieldFilter,
    value: boolean | string,
): string => {
    if (typeof value !== "string") {
        throw new ApiBadRequestError(
            `Custom field filter ${filter.code}.${filter.operator} requires a string value.`,
        );
    }

    return value;
};

const numericOperand = (
    field: FilterableCustomField,
    filter: PeopleCustomFieldFilter,
    value: boolean | string,
): bigint | number | string => {
    const stringValue = stringOperand(filter, value);

    if (field.type === "number") {
        if (!/^-?[0-9]+$/u.test(stringValue)) {
            throw new ApiBadRequestError(
                `Custom field filter ${filter.code}.${filter.operator} requires an integer value.`,
            );
        }

        return BigInt(stringValue);
    }

    if (field.type === "currency") {
        if (!/^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/u.test(stringValue)) {
            throw new ApiBadRequestError(
                `Custom field filter ${filter.code}.${filter.operator} requires a numeric value.`,
            );
        }

        return Number(stringValue);
    }

    if (field.type === "date") {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(stringValue);
        const date = new Date(`${stringValue}T00:00:00.000Z`);

        if (
            match === null ||
            Number.isNaN(date.getTime()) ||
            date.getUTCFullYear() !== Number(match[1]) ||
            date.getUTCMonth() + 1 !== Number(match[2]) ||
            date.getUTCDate() !== Number(match[3])
        ) {
            throw new ApiBadRequestError(
                `Custom field filter ${filter.code}.${filter.operator} requires a date value.`,
            );
        }

        return stringValue;
    }

    if (Number.isNaN(Date.parse(stringValue))) {
        throw new ApiBadRequestError(
            `Custom field filter ${filter.code}.${filter.operator} requires a date-time value.`,
        );
    }

    return stringValue;
};

const comparison = (
    column: ReturnType<typeof customValueColumn>,
    operator: PeopleCustomFieldFilterOperator,
    operand: bigint | boolean | number | string,
): SQL => {
    if (operator === "eq") {
        return sql`${column} = ${operand}`;
    }

    if (operator === "gt") {
        return sql`${column} > ${operand}`;
    }

    if (operator === "gte") {
        return sql`${column} >= ${operand}`;
    }

    if (operator === "lt") {
        return sql`${column} < ${operand}`;
    }

    return sql`${column} <= ${operand}`;
};

const escapeLike = (value: string): string =>
    value.replace(/\\/gu, "\\\\").replace(/%/gu, "\\%").replace(/_/gu, "\\_");

const customFilterCondition = (
    teamId: Ulid,
    field: FilterableCustomField,
    filter: PeopleCustomFieldFilter,
): SQL => {
    if (!operatorsFor(field.type).has(filter.operator)) {
        throw new ApiBadRequestError(
            `Operator ${filter.operator} is not allowed for custom field ${field.code}.`,
        );
    }

    const column = customValueColumn(field.type);
    let valueCondition: SQL;

    if (filter.operator === "contains") {
        const operand = stringOperand(filter, scalarOperand(filter));
        const pattern = `%${escapeLike(operand)}%`;

        valueCondition = ["email", "phone", "link"].includes(field.type)
            ? sql`exists (
                  select 1
                  from jsonb_array_elements_text(coalesce(${column}::jsonb, '[]'::jsonb)) as item(value)
                  where item.value ilike ${pattern} escape '\\'
              )`
            : sql`${column} ilike ${pattern} escape '\\'`;
    } else if (filter.operator === "in") {
        const values = arrayOperand(filter).map((value) =>
            stringOperand(filter, value),
        );
        valueCondition = inArray(column, values);
    } else if (filter.operator === "has_any") {
        const values = arrayOperand(filter).map((value) =>
            stringOperand(filter, value),
        );
        const contains = values.map(
            (value) =>
                sql`${column}::jsonb @> ${JSON.stringify([value])}::jsonb`,
        );
        const condition = or(...contains);

        if (condition === undefined) {
            throw new ApiBadRequestError(
                `Custom field filter ${filter.code}.${filter.operator} requires a value.`,
            );
        }

        valueCondition = condition;
    } else if (["email", "phone", "link"].includes(field.type)) {
        const operand = stringOperand(filter, scalarOperand(filter));
        valueCondition = sql`${column}::jsonb @> ${JSON.stringify(operand)}::jsonb`;
    } else if (["checkbox", "toggle"].includes(field.type)) {
        const operand = scalarOperand(filter);

        if (typeof operand !== "boolean") {
            throw new ApiBadRequestError(
                `Custom field filter ${filter.code}.${filter.operator} requires a boolean value.`,
            );
        }

        valueCondition = comparison(column, filter.operator, operand);
    } else if (
        ["number", "currency", "date", "date-time"].includes(field.type)
    ) {
        valueCondition = comparison(
            column,
            filter.operator,
            numericOperand(field, filter, scalarOperand(filter)),
        );
    } else {
        valueCondition = comparison(
            column,
            filter.operator,
            stringOperand(filter, scalarOperand(filter)),
        );
    }

    return sql`exists (
        select 1
        from ${customFieldValues}
        where ${customFieldValues.tenantId} = ${teamId}
          and ${customFieldValues.entityType} = 'people'
          and ${customFieldValues.entityId} = ${people.id}
          and ${customFieldValues.customFieldId} = ${field.id}
          and ${valueCondition}
    )`;
};

const equalCursorValue = (expression: SQL, value: PeopleCursorValue): SQL =>
    value === null
        ? sql`${expression} is null`
        : sql`${expression} is not distinct from ${value}`;

const compareCursorValue = (
    expression: SQL,
    value: PeopleCursorValue,
    direction: SortDirection,
    pointsToNextItems: boolean,
): SQL => {
    if (pointsToNextItems) {
        if (direction === "asc") {
            return value === null
                ? sql`false`
                : sql`(${expression} > ${value} or ${expression} is null)`;
        }

        return value === null
            ? sql`${expression} is not null`
            : sql`${expression} < ${value}`;
    }

    if (direction === "asc") {
        return value === null
            ? sql`${expression} is not null`
            : sql`${expression} < ${value}`;
    }

    return value === null
        ? sql`false`
        : sql`(${expression} > ${value} or ${expression} is null)`;
};

const cursorCondition = (
    sorts: readonly SortExpression[],
    cursor: PeopleCursor,
): SQL => {
    if (cursor.values.length !== sorts.length) {
        throw new ApiBadRequestError(
            "The cursor does not match the requested sort.",
        );
    }

    const expressions = [
        ...sorts,
        { expression: sql`${people.id}`, direction: "asc" as const },
    ];
    const values: readonly PeopleCursorValue[] = [...cursor.values, cursor.id];
    const branches = expressions.map((sort, index) => {
        const equalities = expressions
            .slice(0, index)
            .map((previous, previousIndex) =>
                equalCursorValue(
                    previous.expression,
                    values[previousIndex] ?? null,
                ),
            );
        const condition = compareCursorValue(
            sort.expression,
            values[index] ?? null,
            sort.direction,
            cursor.pointsToNextItems,
        );

        return and(...equalities, condition) ?? sql`false`;
    });

    return or(...branches) ?? sql`false`;
};

const orderExpression = (sort: SortExpression, reversed: boolean): SQL => {
    const direction = reversed
        ? sort.direction === "asc"
            ? "desc"
            : "asc"
        : sort.direction;

    return direction === "asc" ? asc(sort.expression) : desc(sort.expression);
};

const cursorValuesFrom = (row: CursorRow): readonly PeopleCursorValue[] => {
    if (
        !Array.isArray(row.cursorValues) ||
        !row.cursorValues.every(
            (value) =>
                value === null ||
                typeof value === "boolean" ||
                typeof value === "number" ||
                typeof value === "string",
        )
    ) {
        throw new Error("People cursor values could not be serialized.");
    }

    return row.cursorValues;
};

const cursorFor = (row: CursorRow, pointsToNextItems: boolean): string =>
    encodePeopleCursor({
        values: cursorValuesFrom(row),
        id: ulidSchema.parse(row.id),
        pointsToNextItems,
    });

const initializeCounts = (
    personIds: readonly Ulid[],
): Map<Ulid, PeopleRelationshipCounts> =>
    new Map(personIds.map((personId) => [personId, {}]));

const setCount = (
    counts: Map<Ulid, PeopleRelationshipCounts>,
    personId: string,
    key: keyof PeopleRelationshipCounts,
    value: number,
): void => {
    const id = ulidSchema.parse(personId);
    counts.set(id, { ...counts.get(id), [key]: value });
};

export class DrizzlePeopleRepository implements PeopleRepository {
    public constructor(
        private readonly activity: ActivityWriter,
        private readonly database: Database = getDatabase(),
    ) {}

    public async list(
        teamId: Ulid,
        query: PeopleListQuery,
    ): Promise<PeopleListPage> {
        const fieldsByCode = await this.resolveRequestedCustomFields(
            teamId,
            query,
        );
        const conditions: SQL[] = [
            eq(people.teamId, teamId),
            isNull(people.deletedAt),
        ];

        if (query.filters.name !== undefined) {
            conditions.push(ilike(people.name, `%${query.filters.name}%`));
        }

        if (query.filters.companyId !== undefined) {
            conditions.push(eq(people.companyId, query.filters.companyId));
        }

        if (query.filters.createdAfter !== undefined) {
            conditions.push(
                sql`${people.createdAt}::date >= ${query.filters.createdAfter}::date`,
            );
        }

        if (query.filters.createdBefore !== undefined) {
            conditions.push(
                sql`${people.createdAt}::date <= ${query.filters.createdBefore}::date`,
            );
        }

        for (const filter of query.filters.customFields) {
            const field = fieldsByCode.get(filter.code);

            if (field === undefined) {
                throw new ApiBadRequestError(
                    `Requested custom field filter ${filter.code} is not allowed.`,
                );
            }

            conditions.push(customFilterCondition(teamId, field, filter));
        }

        const sorts = query.sorts.map((sort) =>
            sortExpression(teamId, sort, fieldsByCode),
        );

        if (query.pagination.kind === "page") {
            return this.listPage(query, conditions, sorts);
        }

        return this.listCursor(query, conditions, sorts);
    }

    public async find(
        teamId: Ulid,
        personId: Ulid,
    ): Promise<PeopleRecord | undefined> {
        const [person] = await this.database
            .select()
            .from(people)
            .where(
                and(
                    eq(people.teamId, teamId),
                    eq(people.id, personId),
                    isNull(people.deletedAt),
                ),
            )
            .limit(1);

        return person === undefined ? undefined : toPeopleRecord(person);
    }

    public async companyExists(
        teamId: Ulid,
        companyId: Ulid,
    ): Promise<boolean> {
        const [company] = await this.database
            .select({ id: companies.id })
            .from(companies)
            .where(
                and(
                    eq(companies.teamId, teamId),
                    eq(companies.id, companyId),
                    isNull(companies.deletedAt),
                ),
            )
            .limit(1);

        return company !== undefined;
    }

    public async create(input: CreatePeopleTransaction): Promise<PeopleRecord> {
        return this.database.transaction(async (transaction) => {
            const batchUuid = this.activity.batchUuid();
            const [created] = await transaction
                .insert(people)
                .values({
                    id: input.id,
                    teamId: input.teamId,
                    creatorId: input.creatorId,
                    companyId: input.companyId,
                    name: input.name,
                    creationSource: input.creationSource,
                    createdAt: input.occurredAt,
                    updatedAt: input.occurredAt,
                    deletedAt: null,
                })
                .returning();

            if (created === undefined) {
                throw new Error(
                    "People insert did not return the created row.",
                );
            }

            await this.activity.writeNative(transaction, {
                teamId: input.teamId,
                subjectType: "people",
                subjectId: input.id,
                causerId: input.creatorId,
                event: "created",
                attributes: {
                    name: input.name,
                    company_id: input.companyId,
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

            return toPeopleRecord(created);
        });
    }

    public async update(
        input: UpdatePeopleTransaction,
        causerId: Ulid,
    ): Promise<PeopleRecord | undefined> {
        return this.database.transaction(async (transaction) => {
            const batchUuid = this.activity.batchUuid();
            const [existing] = await transaction
                .select()
                .from(people)
                .where(
                    and(
                        eq(people.teamId, input.teamId),
                        eq(people.id, input.id),
                        isNull(people.deletedAt),
                    ),
                )
                .limit(1)
                .for("update");

            if (existing === undefined) {
                return undefined;
            }

            const [updated] = await transaction
                .update(people)
                .set({
                    updatedAt: input.occurredAt,
                    ...(input.name === undefined ? {} : { name: input.name }),
                    ...(Object.hasOwn(input, "companyId")
                        ? { companyId: input.companyId ?? null }
                        : {}),
                })
                .where(
                    and(
                        eq(people.teamId, input.teamId),
                        eq(people.id, input.id),
                        isNull(people.deletedAt),
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

            await this.activity.writeNative(transaction, {
                teamId: input.teamId,
                subjectType: "people",
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

            return toPeopleRecord(updated);
        });
    }

    public async softDelete(
        teamId: Ulid,
        personId: Ulid,
        occurredAt: Date,
        causerId: Ulid,
    ): Promise<boolean> {
        return this.database.transaction(async (transaction) => {
            const [deleted] = await transaction
                .update(people)
                .set({ deletedAt: occurredAt, updatedAt: occurredAt })
                .where(
                    and(
                        eq(people.teamId, teamId),
                        eq(people.id, personId),
                        isNull(people.deletedAt),
                    ),
                )
                .returning({ id: people.id });

            if (deleted === undefined) {
                return false;
            }

            await this.activity.writeNative(transaction, {
                teamId,
                subjectType: "people",
                subjectId: personId,
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
        peopleRecords: readonly PeopleRecord[],
    ): Promise<readonly PeopleUserRecord[]> {
        if (peopleRecords.length === 0) {
            return [];
        }

        const rows = await this.database
            .selectDistinct({
                id: users.id,
                name: users.name,
                email: users.email,
            })
            .from(users)
            .innerJoin(people, eq(people.creatorId, users.id))
            .where(
                and(
                    eq(people.teamId, teamId),
                    inArray(
                        people.id,
                        peopleRecords.map((person) => person.id),
                    ),
                    isNull(people.deletedAt),
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
    ): Promise<readonly PeopleCompanyRecord[]> {
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

    public async loadRelationshipCounts(
        teamId: Ulid,
        personIds: readonly Ulid[],
        includes: readonly PeopleCountInclude[],
    ): Promise<ReadonlyMap<Ulid, PeopleRelationshipCounts>> {
        const counts = initializeCounts(personIds);

        if (personIds.length === 0) {
            return counts;
        }

        if (includes.includes("tasksCount")) {
            const rows = await this.database
                .select({
                    personId: taskables.taskableId,
                    count: sql<number>`count(*)::integer`,
                })
                .from(taskables)
                .innerJoin(tasks, eq(tasks.id, taskables.taskId))
                .where(
                    and(
                        eq(tasks.teamId, teamId),
                        eq(taskables.taskableType, "people"),
                        inArray(taskables.taskableId, personIds),
                        isNull(tasks.deletedAt),
                    ),
                )
                .groupBy(taskables.taskableId);

            for (const row of rows) {
                setCount(counts, row.personId, "tasksCount", row.count);
            }
        }

        if (includes.includes("notesCount")) {
            const rows = await this.database
                .select({
                    personId: noteables.noteableId,
                    count: sql<number>`count(*)::integer`,
                })
                .from(noteables)
                .innerJoin(notes, eq(notes.id, noteables.noteId))
                .where(
                    and(
                        eq(notes.teamId, teamId),
                        eq(noteables.noteableType, "people"),
                        inArray(noteables.noteableId, personIds),
                        isNull(notes.deletedAt),
                    ),
                )
                .groupBy(noteables.noteableId);

            for (const row of rows) {
                setCount(counts, row.personId, "notesCount", row.count);
            }
        }

        for (const personId of personIds) {
            const current = counts.get(personId) ?? {};
            counts.set(personId, {
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

    private async resolveRequestedCustomFields(
        teamId: Ulid,
        query: PeopleListQuery,
    ): Promise<ReadonlyMap<string, FilterableCustomField>> {
        const requestedCodes = new Set([
            ...query.filters.customFields.map((filter) => filter.code),
            ...query.sorts
                .filter((sort) => !nativeSortFields.has(sort.field))
                .map((sort) => sort.field),
        ]);

        if (requestedCodes.size === 0) {
            return new Map();
        }

        const rows = await this.database
            .select({
                id: customFields.id,
                code: customFields.code,
                type: customFields.type,
            })
            .from(customFields)
            .where(
                and(
                    eq(customFields.tenantId, teamId),
                    eq(customFields.entityType, "people"),
                    eq(customFields.active, true),
                    inArray(customFields.code, [...requestedCodes]),
                    inArray(customFields.type, supportedCustomFieldTypes),
                    sql`coalesce(${customFields.settings}->>'encrypted', 'false') <> 'true'`,
                ),
            );
        const resolved = new Map<string, FilterableCustomField>(
            rows.map((row) => [
                row.code,
                {
                    id: ulidSchema.parse(row.id),
                    code: row.code,
                    type: row.type as FilterableCustomFieldType,
                },
            ]),
        );

        for (const code of requestedCodes) {
            if (!resolved.has(code)) {
                throw new ApiBadRequestError(
                    `Requested custom field ${code} is not filterable or sortable.`,
                );
            }
        }

        return resolved;
    }

    private async listPage(
        query: PeopleListQuery,
        conditions: readonly SQL[],
        sorts: readonly SortExpression[],
    ): Promise<PeopleListPage> {
        const where = and(...conditions);
        const page =
            query.pagination.kind === "page" ? query.pagination.page : 1;
        const [rows, totalRows] = await Promise.all([
            this.database
                .select()
                .from(people)
                .where(where)
                .orderBy(
                    ...sorts.map((sort) => orderExpression(sort, false)),
                    asc(people.id),
                )
                .limit(query.perPage)
                .offset((page - 1) * query.perPage),
            this.database
                .select({ total: sql<number>`count(*)::integer` })
                .from(people)
                .where(where),
        ]);

        return {
            kind: "page",
            records: rows.map(toPeopleRecord),
            total: totalRows[0]?.total ?? 0,
        };
    }

    private async listCursor(
        query: PeopleListQuery,
        conditions: readonly SQL[],
        sorts: readonly SortExpression[],
    ): Promise<PeopleListPage> {
        if (query.pagination.kind !== "cursor") {
            throw new Error("Cursor pagination requires a cursor query.");
        }

        const cursor = query.pagination.cursor;
        const reversed = cursor?.pointsToNextItems === false;
        const where = and(
            ...conditions,
            ...(cursor === undefined ? [] : [cursorCondition(sorts, cursor)]),
        );
        const cursorValueSql = sql`jsonb_build_array(${sql.join(
            sorts.map((sort) => sql`${sort.expression}::text`),
            sql.raw(", "),
        )})`;
        const fetched = await this.database
            .select({
                ...getTableColumns(people),
                cursorValues: cursorValueSql.as("cursor_values"),
            })
            .from(people)
            .where(where)
            .orderBy(
                ...sorts.map((sort) => orderExpression(sort, reversed)),
                reversed ? desc(people.id) : asc(people.id),
            )
            .limit(query.perPage + 1);
        const hasMore = fetched.length > query.perPage;
        const sliced = fetched.slice(0, query.perPage);
        const rows = (reversed ? sliced.reverse() : sliced) as CursorRow[];
        const first = rows[0];
        const last = rows.at(-1);
        const previousCursor =
            first === undefined ||
            cursor === undefined ||
            (!cursor.pointsToNextItems && !hasMore)
                ? null
                : cursorFor(first, false);
        const nextCursor =
            last === undefined ||
            ((cursor === undefined || cursor.pointsToNextItems) && !hasMore)
                ? null
                : cursorFor(last, true);

        return {
            kind: "cursor",
            records: rows.map(toPeopleRecord),
            nextCursor,
            previousCursor,
        };
    }
}
