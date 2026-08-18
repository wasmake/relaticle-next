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

import { ApiBadRequestError, ApiValidationError } from "@/server/api/errors";
import type { ActivityWriter } from "@/server/activity/writer";
import {
    persistPreparedCustomFields,
    type DatabaseTransaction,
} from "@/server/custom-fields/persist";
import { customFieldStorageColumnForType } from "@/server/custom-fields/storage";
import type { CustomFieldType } from "@/server/custom-fields/types";
import { getDatabase } from "@/server/db/client";
import {
    companies,
    customFields,
    customFieldValues,
    opportunities,
    people,
    tasks,
    taskables,
    taskUser,
    teams,
    teamUser,
    users,
} from "@/server/db/schema";
import { ulidSchema, type Ulid } from "@/server/ids";
import { userBelongsToTeam } from "@/server/tenancy/user-scope";

import type {
    CreateTaskTransaction,
    TasksRepository,
    TaskMutationResult,
    UpdateTaskTransaction,
} from "./repository";
import type {
    TaskCompanyRecord,
    TaskCountInclude,
    TaskCustomFieldFilter,
    TaskListPage,
    TaskListQuery,
    TaskOpportunityRecord,
    TaskPersonRecord,
    TaskRecord,
    TaskRelationshipCounts,
    TaskRelationshipIds,
    TaskSort,
    TaskUserRecord,
    TaskUserRelationship,
} from "./types";

type Database = ReturnType<typeof getDatabase>;

type TaskQueryCustomField = Readonly<{
    id: Ulid;
    code: string;
    type: CustomFieldType;
}>;

const builtInSorts = new Set(["title", "created_at", "updated_at"]);
const filterableTypes = new Set<CustomFieldType>([
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
]);
const numericTypes = new Set<CustomFieldType>([
    "number",
    "currency",
    "date",
    "date-time",
]);
const stringTypes = new Set<CustomFieldType>([
    "text",
    "email",
    "phone",
    "link",
]);
const singleChoiceTypes = new Set<CustomFieldType>([
    "select",
    "radio",
    "toggle-buttons",
]);
const multiChoiceTypes = new Set<CustomFieldType>([
    "multi-select",
    "checkbox-list",
    "tags-input",
]);

const toTaskRecord = (row: typeof tasks.$inferSelect): TaskRecord => ({
    id: ulidSchema.parse(row.id),
    teamId: ulidSchema.parse(row.teamId),
    creatorId: row.creatorId === null ? null : ulidSchema.parse(row.creatorId),
    title: row.title,
    creationSource: row.creationSource,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
});

const uniqueIds = (ids: readonly Ulid[]): readonly Ulid[] => [...new Set(ids)];

const isEncrypted = (settings: unknown): boolean =>
    typeof settings === "object" &&
    settings !== null &&
    !Array.isArray(settings) &&
    "encrypted" in settings &&
    settings.encrypted === true;

const initializeCounts = (
    taskIds: readonly Ulid[],
): Map<Ulid, TaskRelationshipCounts> =>
    new Map(taskIds.map((taskId) => [taskId, {}]));

const setCount = (
    counts: Map<Ulid, TaskRelationshipCounts>,
    taskId: string,
    key: keyof TaskRelationshipCounts,
    value: number,
): void => {
    const id = ulidSchema.parse(taskId);
    counts.set(id, { ...counts.get(id), [key]: value });
};

const customFieldColumn = (field: TaskQueryCustomField) => {
    const storageColumn = customFieldStorageColumnForType(field.type);

    return customFieldValues[storageColumn];
};

const operatorsFor = (type: CustomFieldType): ReadonlySet<string> => {
    if (numericTypes.has(type)) {
        return new Set(["eq", "gt", "gte", "lt", "lte"]);
    }

    if (stringTypes.has(type)) {
        return new Set(["eq", "contains"]);
    }

    if (type === "checkbox" || type === "toggle") {
        return new Set(["eq"]);
    }

    if (singleChoiceTypes.has(type)) {
        return new Set(["eq", "in"]);
    }

    if (multiChoiceTypes.has(type)) {
        return new Set(["has_any"]);
    }

    return new Set();
};

const scalarOperand = (
    field: TaskQueryCustomField,
    operand: string,
): boolean | bigint | Date | number | string | undefined => {
    if (field.type === "number") {
        try {
            return BigInt(operand);
        } catch {
            return undefined;
        }
    }

    if (field.type === "currency") {
        const value = Number(operand);

        return Number.isFinite(value) ? value : undefined;
    }

    if (field.type === "checkbox" || field.type === "toggle") {
        const normalized = operand.toLocaleLowerCase();

        if (["1", "true"].includes(normalized)) {
            return true;
        }

        if (["0", "false"].includes(normalized)) {
            return false;
        }

        return undefined;
    }

    if (field.type === "date-time") {
        const value = new Date(operand);

        return Number.isNaN(value.getTime()) ? undefined : value;
    }

    return operand;
};

const customFieldCondition = (
    field: TaskQueryCustomField,
    filter: TaskCustomFieldFilter,
): SQL | undefined => {
    if (!operatorsFor(field.type).has(filter.operator)) {
        return undefined;
    }

    const column = customFieldColumn(field);
    const rawOperands = Array.isArray(filter.operand)
        ? filter.operand
        : [filter.operand];
    const operands = rawOperands
        .map((operand) => scalarOperand(field, operand))
        .filter((operand) => operand !== undefined);

    if (operands.length === 0) {
        return sql`false`;
    }

    const operand = operands[0];

    if (filter.operator === "contains") {
        const escaped = String(operand)
            .replaceAll("\\", "\\\\")
            .replaceAll("%", "\\%")
            .replaceAll("_", "\\_");

        return sql`${column}::text ILIKE ${`%${escaped}%`} ESCAPE '\\'`;
    }

    if (filter.operator === "in") {
        return sql`${column} IN (${sql.join(
            operands.map((value) => sql`${value}`),
            sql`, `,
        )})`;
    }

    if (filter.operator === "has_any") {
        return sql`${column}::jsonb @> ${JSON.stringify(operand)}::jsonb`;
    }

    if (
        filter.operator === "eq" &&
        (field.type === "email" ||
            field.type === "phone" ||
            field.type === "link")
    ) {
        return sql`${column}::jsonb @> ${JSON.stringify(operand)}::jsonb`;
    }

    const operator = {
        eq: sql`=`,
        gt: sql`>`,
        gte: sql`>=`,
        lt: sql`<`,
        lte: sql`<=`,
    }[filter.operator];

    return operator === undefined
        ? undefined
        : sql`${column} ${operator} ${operand}`;
};

const customFieldExists = (
    database: Database,
    field: TaskQueryCustomField,
    filter: TaskCustomFieldFilter,
): SQL | undefined => {
    const valueCondition = customFieldCondition(field, filter);

    if (valueCondition === undefined) {
        return undefined;
    }

    return exists(
        database
            .select({ value: customFieldValues.id })
            .from(customFieldValues)
            .where(
                and(
                    eq(customFieldValues.tenantId, tasks.teamId),
                    eq(customFieldValues.entityType, "task"),
                    eq(customFieldValues.entityId, tasks.id),
                    eq(customFieldValues.customFieldId, field.id),
                    valueCondition,
                ),
            ),
    );
};

const orderFor = (
    sort: TaskSort,
    queryFields: ReadonlyMap<string, TaskQueryCustomField>,
): SQL => {
    let expression:
        | SQL
        | typeof tasks.title
        | typeof tasks.createdAt
        | typeof tasks.updatedAt;

    if (sort.field === "title") {
        expression = tasks.title;
    } else if (sort.field === "created_at") {
        expression = tasks.createdAt;
    } else if (sort.field === "updated_at") {
        expression = tasks.updatedAt;
    } else {
        const field = queryFields.get(sort.field);

        if (field === undefined) {
            throw new ApiBadRequestError(
                `Requested sort ${sort.field} is not allowed.`,
            );
        }

        const column = customFieldColumn(field);
        const sortableColumn =
            customFieldStorageColumnForType(field.type) === "jsonValue"
                ? sql`${column}::text`
                : sql`${column}`;
        expression = sql`(
            select ${sortableColumn}
            from ${customFieldValues}
            where ${customFieldValues.tenantId} = ${tasks.teamId}
              and ${customFieldValues.entityType} = 'task'
              and ${customFieldValues.entityId} = ${tasks.id}
              and ${customFieldValues.customFieldId} = ${field.id}
            limit 1
        )`;
    }

    return sort.direction === "asc" ? asc(expression) : desc(expression);
};

const assertTenantReferences = async (
    transaction: DatabaseTransaction,
    teamId: Ulid,
    relationships: TaskRelationshipIds,
): Promise<void> => {
    const companyIds = uniqueIds(relationships.companyIds ?? []);
    const peopleIds = uniqueIds(relationships.peopleIds ?? []);
    const opportunityIds = uniqueIds(relationships.opportunityIds ?? []);
    const assigneeIds = uniqueIds(relationships.assigneeIds ?? []);
    const [companyRows, peopleRows, opportunityRows, memberRows, ownerRows] =
        await Promise.all([
            companyIds.length === 0
                ? []
                : transaction
                      .select({ id: companies.id })
                      .from(companies)
                      .where(
                          and(
                              eq(companies.teamId, teamId),
                              inArray(companies.id, companyIds),
                              isNull(companies.deletedAt),
                          ),
                      ),
            peopleIds.length === 0
                ? []
                : transaction
                      .select({ id: people.id })
                      .from(people)
                      .where(
                          and(
                              eq(people.teamId, teamId),
                              inArray(people.id, peopleIds),
                              isNull(people.deletedAt),
                          ),
                      ),
            opportunityIds.length === 0
                ? []
                : transaction
                      .select({ id: opportunities.id })
                      .from(opportunities)
                      .where(
                          and(
                              eq(opportunities.teamId, teamId),
                              inArray(opportunities.id, opportunityIds),
                              isNull(opportunities.deletedAt),
                          ),
                      ),
            assigneeIds.length === 0
                ? []
                : transaction
                      .select({ id: teamUser.userId })
                      .from(teamUser)
                      .where(
                          and(
                              eq(teamUser.teamId, teamId),
                              inArray(teamUser.userId, assigneeIds),
                          ),
                      ),
            assigneeIds.length === 0
                ? []
                : transaction
                      .select({ id: teams.userId })
                      .from(teams)
                      .where(
                          and(
                              eq(teams.id, teamId),
                              inArray(teams.userId, assigneeIds),
                          ),
                      ),
        ]);
    const validByField = {
        company_ids: new Set(companyRows.map(({ id }) => id)),
        people_ids: new Set(peopleRows.map(({ id }) => id)),
        opportunity_ids: new Set(opportunityRows.map(({ id }) => id)),
        assignee_ids: new Set([
            ...memberRows.map(({ id }) => id),
            ...ownerRows.map(({ id }) => id),
        ]),
    };
    const submittedByField = {
        company_ids: relationships.companyIds,
        people_ids: relationships.peopleIds,
        opportunity_ids: relationships.opportunityIds,
        assignee_ids: relationships.assigneeIds,
    };
    const issues: Array<{ path: string; message: string }> = [];

    for (const field of Object.keys(submittedByField) as Array<
        keyof typeof submittedByField
    >) {
        const submitted = submittedByField[field];

        if (submitted === undefined) {
            continue;
        }

        submitted.forEach((id, index) => {
            if (!validByField[field].has(id)) {
                issues.push({
                    path: `${field}.${index}`,
                    message:
                        field === "assignee_ids"
                            ? "The selected assignee is not in your workspace."
                            : `The selected ${field}.${index} is invalid.`,
                });
            }
        });
    }

    if (issues.length > 0) {
        throw new ApiValidationError(issues);
    }
};

const syncTaskables = async (
    transaction: DatabaseTransaction,
    taskId: Ulid,
    type: "company" | "people" | "opportunity",
    ids: readonly Ulid[],
    occurredAt: Date,
): Promise<void> => {
    await transaction
        .delete(taskables)
        .where(
            and(eq(taskables.taskId, taskId), eq(taskables.taskableType, type)),
        );

    const unique = uniqueIds(ids);

    if (unique.length > 0) {
        await transaction.insert(taskables).values(
            unique.map((id) => ({
                taskId,
                taskableType: type,
                taskableId: id,
                createdAt: occurredAt,
                updatedAt: occurredAt,
            })),
        );
    }
};

const syncAssignees = async (
    transaction: DatabaseTransaction,
    taskId: Ulid,
    ids: readonly Ulid[],
    occurredAt: Date,
): Promise<void> => {
    await transaction.delete(taskUser).where(eq(taskUser.taskId, taskId));
    const unique = uniqueIds(ids);

    if (unique.length > 0) {
        await transaction.insert(taskUser).values(
            unique.map((userId) => ({
                taskId,
                userId,
                createdAt: occurredAt,
                updatedAt: occurredAt,
            })),
        );
    }
};

export class DrizzleTasksRepository implements TasksRepository {
    public constructor(
        private readonly activity: ActivityWriter,
        private readonly database: Database = getDatabase(),
    ) {}

    public async list(
        teamId: Ulid,
        userId: Ulid,
        query: TaskListQuery,
    ): Promise<TaskListPage> {
        const queryFields = await this.loadQueryCustomFields(teamId, query);
        const conditions: SQL[] = [
            eq(tasks.teamId, teamId),
            isNull(tasks.deletedAt),
        ];

        if (query.filters.title !== undefined) {
            conditions.push(ilike(tasks.title, `%${query.filters.title}%`));
        }

        if (query.filters.assignedToMe === true) {
            conditions.push(
                exists(
                    this.database
                        .select({ id: taskUser.id })
                        .from(taskUser)
                        .where(
                            and(
                                eq(taskUser.taskId, tasks.id),
                                eq(taskUser.userId, userId),
                            ),
                        ),
                ),
            );
        }

        if (
            query.filters.assigneeIds !== undefined &&
            query.filters.assigneeIds.length > 0
        ) {
            conditions.push(
                exists(
                    this.database
                        .select({ id: taskUser.id })
                        .from(taskUser)
                        .where(
                            and(
                                eq(taskUser.taskId, tasks.id),
                                inArray(
                                    taskUser.userId,
                                    query.filters.assigneeIds,
                                ),
                            ),
                        ),
                ),
            );
        }

        const relatedFilters = [
            ["company", query.filters.companyId],
            ["people", query.filters.peopleId],
            ["opportunity", query.filters.opportunityId],
        ] as const;

        for (const [type, id] of relatedFilters) {
            if (id !== undefined) {
                const relatedExists =
                    type === "company"
                        ? exists(
                              this.database
                                  .select({ id: companies.id })
                                  .from(companies)
                                  .where(
                                      and(
                                          eq(
                                              companies.id,
                                              taskables.taskableId,
                                          ),
                                          eq(companies.teamId, teamId),
                                          isNull(companies.deletedAt),
                                      ),
                                  ),
                          )
                        : type === "people"
                          ? exists(
                                this.database
                                    .select({ id: people.id })
                                    .from(people)
                                    .where(
                                        and(
                                            eq(people.id, taskables.taskableId),
                                            eq(people.teamId, teamId),
                                            isNull(people.deletedAt),
                                        ),
                                    ),
                            )
                          : exists(
                                this.database
                                    .select({ id: opportunities.id })
                                    .from(opportunities)
                                    .where(
                                        and(
                                            eq(
                                                opportunities.id,
                                                taskables.taskableId,
                                            ),
                                            eq(opportunities.teamId, teamId),
                                            isNull(opportunities.deletedAt),
                                        ),
                                    ),
                            );
                conditions.push(
                    exists(
                        this.database
                            .select({ rowId: taskables.id })
                            .from(taskables)
                            .where(
                                and(
                                    eq(taskables.taskId, tasks.id),
                                    eq(taskables.taskableType, type),
                                    eq(taskables.taskableId, id),
                                    relatedExists,
                                ),
                            ),
                    ),
                );
            }
        }

        if (query.filters.createdAfter !== undefined) {
            conditions.push(
                sql`${tasks.createdAt}::date >= ${query.filters.createdAfter}::date`,
            );
        }

        if (query.filters.createdBefore !== undefined) {
            conditions.push(
                sql`${tasks.createdAt}::date <= ${query.filters.createdBefore}::date`,
            );
        }

        for (const filter of query.filters.customFields) {
            const field = queryFields.get(filter.code);

            if (field === undefined) {
                continue;
            }

            const condition = customFieldExists(this.database, field, filter);

            if (condition !== undefined) {
                conditions.push(condition);
            }
        }

        const where = and(...conditions);
        const [rows, totalRows] = await Promise.all([
            this.database
                .select()
                .from(tasks)
                .where(where)
                .orderBy(
                    ...query.sorts.map((sort) => orderFor(sort, queryFields)),
                    asc(tasks.id),
                )
                .limit(query.perPage)
                .offset((query.page - 1) * query.perPage),
            this.database
                .select({ total: sql<number>`count(*)::integer` })
                .from(tasks)
                .where(where),
        ]);

        return {
            records: rows.map(toTaskRecord),
            total: totalRows[0]?.total ?? 0,
        };
    }

    public async find(
        teamId: Ulid,
        taskId: Ulid,
    ): Promise<TaskRecord | undefined> {
        const [task] = await this.database
            .select()
            .from(tasks)
            .where(
                and(
                    eq(tasks.teamId, teamId),
                    eq(tasks.id, taskId),
                    isNull(tasks.deletedAt),
                ),
            )
            .limit(1);

        return task === undefined ? undefined : toTaskRecord(task);
    }

    public async create(
        input: CreateTaskTransaction,
    ): Promise<TaskMutationResult> {
        return this.database.transaction(async (transaction) => {
            const batchUuid = this.activity.batchUuid();
            await assertTenantReferences(transaction, input.teamId, input);
            const [created] = await transaction
                .insert(tasks)
                .values({
                    id: input.id,
                    teamId: input.teamId,
                    creatorId: input.creatorId,
                    title: input.title,
                    creationSource: input.creationSource,
                    orderColumn: sql`(
                        select coalesce(max(${tasks.orderColumn}), 0) + 1
                        from ${tasks}
                        where ${tasks.teamId} = ${input.teamId}
                          and ${tasks.deletedAt} is null
                    )`,
                    createdAt: input.occurredAt,
                    updatedAt: input.occurredAt,
                    deletedAt: null,
                })
                .returning();

            if (created === undefined) {
                throw new Error("Task insert did not return the created row.");
            }

            if (input.companyIds !== undefined) {
                await syncTaskables(
                    transaction,
                    input.id,
                    "company",
                    input.companyIds,
                    input.occurredAt,
                );
            }
            if (input.peopleIds !== undefined) {
                await syncTaskables(
                    transaction,
                    input.id,
                    "people",
                    input.peopleIds,
                    input.occurredAt,
                );
            }
            if (input.opportunityIds !== undefined) {
                await syncTaskables(
                    transaction,
                    input.id,
                    "opportunity",
                    input.opportunityIds,
                    input.occurredAt,
                );
            }
            if (input.assigneeIds !== undefined) {
                await syncAssignees(
                    transaction,
                    input.id,
                    input.assigneeIds,
                    input.occurredAt,
                );
            }

            await this.activity.writeNative(transaction, {
                teamId: input.teamId,
                subjectType: "task",
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

            return {
                record: toTaskRecord(created),
                newAssigneeIds: uniqueIds(input.assigneeIds ?? []),
            };
        });
    }

    public async update(
        input: UpdateTaskTransaction,
        causerId: Ulid,
    ): Promise<TaskMutationResult | undefined> {
        return this.database.transaction(async (transaction) => {
            const batchUuid = this.activity.batchUuid();
            const [existing] = await transaction
                .select()
                .from(tasks)
                .where(
                    and(
                        eq(tasks.teamId, input.teamId),
                        eq(tasks.id, input.id),
                        isNull(tasks.deletedAt),
                    ),
                )
                .limit(1)
                .for("update");

            if (existing === undefined) {
                return undefined;
            }

            await assertTenantReferences(transaction, input.teamId, input);
            const previousAssigneeIds =
                input.assigneeIds === undefined
                    ? []
                    : (
                          await transaction
                              .select({ id: taskUser.userId })
                              .from(taskUser)
                              .where(eq(taskUser.taskId, input.id))
                      ).map(({ id }) => ulidSchema.parse(id));
            const [updated] = await transaction
                .update(tasks)
                .set({
                    updatedAt: input.occurredAt,
                    ...(input.title === undefined
                        ? {}
                        : { title: input.title }),
                })
                .where(
                    and(
                        eq(tasks.teamId, input.teamId),
                        eq(tasks.id, input.id),
                        isNull(tasks.deletedAt),
                    ),
                )
                .returning();

            if (updated === undefined) {
                return undefined;
            }

            const titleChanged = existing.title !== updated.title;

            await this.activity.writeNative(transaction, {
                teamId: input.teamId,
                subjectType: "task",
                subjectId: input.id,
                causerId,
                event: "updated",
                attributes: titleChanged ? { title: updated.title } : {},
                old: titleChanged ? { title: existing.title } : {},
                batchUuid,
                occurredAt: input.occurredAt,
            });

            if (input.companyIds !== undefined) {
                await syncTaskables(
                    transaction,
                    input.id,
                    "company",
                    input.companyIds,
                    input.occurredAt,
                );
            }
            if (input.peopleIds !== undefined) {
                await syncTaskables(
                    transaction,
                    input.id,
                    "people",
                    input.peopleIds,
                    input.occurredAt,
                );
            }
            if (input.opportunityIds !== undefined) {
                await syncTaskables(
                    transaction,
                    input.id,
                    "opportunity",
                    input.opportunityIds,
                    input.occurredAt,
                );
            }
            if (input.assigneeIds !== undefined) {
                await syncAssignees(
                    transaction,
                    input.id,
                    input.assigneeIds,
                    input.occurredAt,
                );
            }
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

            const previous = new Set(previousAssigneeIds);

            return {
                record: toTaskRecord(updated),
                newAssigneeIds:
                    input.assigneeIds === undefined
                        ? []
                        : uniqueIds(input.assigneeIds).filter(
                              (id) => !previous.has(id),
                          ),
            };
        });
    }

    public async softDelete(
        teamId: Ulid,
        taskId: Ulid,
        occurredAt: Date,
        causerId: Ulid,
    ): Promise<boolean> {
        return this.database.transaction(async (transaction) => {
            const [deleted] = await transaction
                .update(tasks)
                .set({ deletedAt: occurredAt, updatedAt: occurredAt })
                .where(
                    and(
                        eq(tasks.teamId, teamId),
                        eq(tasks.id, taskId),
                        isNull(tasks.deletedAt),
                    ),
                )
                .returning({ id: tasks.id });

            if (deleted === undefined) {
                return false;
            }

            await this.activity.writeNative(transaction, {
                teamId,
                subjectType: "task",
                subjectId: taskId,
                causerId,
                event: "deleted",
                batchUuid: this.activity.batchUuid(),
                occurredAt,
            });

            return true;
        });
    }

    public async loadCreators(
        teamId: Ulid,
        taskRecords: readonly TaskRecord[],
    ): Promise<readonly TaskUserRecord[]> {
        if (taskRecords.length === 0) {
            return [];
        }

        const rows = await this.database
            .selectDistinct({
                id: users.id,
                name: users.name,
                email: users.email,
            })
            .from(users)
            .innerJoin(tasks, eq(tasks.creatorId, users.id))
            .where(
                and(
                    eq(tasks.teamId, teamId),
                    inArray(
                        tasks.id,
                        taskRecords.map((task) => task.id),
                    ),
                    isNull(tasks.deletedAt),
                    userBelongsToTeam(users.id, teamId),
                ),
            );

        return rows.map((row) => ({
            id: ulidSchema.parse(row.id),
            name: row.name,
            email: row.email,
        }));
    }

    public async loadAssignees(
        teamId: Ulid,
        taskIds: readonly Ulid[],
    ): Promise<readonly TaskUserRelationship[]> {
        if (taskIds.length === 0) {
            return [];
        }

        const rows = await this.database
            .select({
                taskId: taskUser.taskId,
                id: users.id,
                name: users.name,
                email: users.email,
            })
            .from(taskUser)
            .innerJoin(users, eq(users.id, taskUser.userId))
            .innerJoin(tasks, eq(tasks.id, taskUser.taskId))
            .where(
                and(
                    eq(tasks.teamId, teamId),
                    inArray(tasks.id, taskIds),
                    isNull(tasks.deletedAt),
                    userBelongsToTeam(users.id, teamId),
                ),
            )
            .orderBy(asc(taskUser.id));

        return rows.map((row) => ({
            taskId: ulidSchema.parse(row.taskId),
            user: {
                id: ulidSchema.parse(row.id),
                name: row.name,
                email: row.email,
            },
        }));
    }

    public async loadCompanies(
        teamId: Ulid,
        taskIds: readonly Ulid[],
    ): Promise<readonly TaskCompanyRecord[]> {
        if (taskIds.length === 0) {
            return [];
        }

        const rows = await this.database
            .select({ taskId: taskables.taskId, company: companies })
            .from(taskables)
            .innerJoin(companies, eq(companies.id, taskables.taskableId))
            .innerJoin(tasks, eq(tasks.id, taskables.taskId))
            .where(
                and(
                    eq(tasks.teamId, teamId),
                    eq(companies.teamId, teamId),
                    eq(taskables.taskableType, "company"),
                    inArray(tasks.id, taskIds),
                    isNull(tasks.deletedAt),
                    isNull(companies.deletedAt),
                ),
            )
            .orderBy(asc(taskables.id));

        return rows.map(({ taskId, company }) => ({
            taskId: ulidSchema.parse(taskId),
            id: ulidSchema.parse(company.id),
            teamId: ulidSchema.parse(company.teamId),
            name: company.name,
            creationSource: company.creationSource,
            createdAt: company.createdAt,
            updatedAt: company.updatedAt,
        }));
    }

    public async loadPeople(
        teamId: Ulid,
        taskIds: readonly Ulid[],
    ): Promise<readonly TaskPersonRecord[]> {
        if (taskIds.length === 0) {
            return [];
        }

        const rows = await this.database
            .select({ taskId: taskables.taskId, person: people })
            .from(taskables)
            .innerJoin(people, eq(people.id, taskables.taskableId))
            .innerJoin(tasks, eq(tasks.id, taskables.taskId))
            .where(
                and(
                    eq(tasks.teamId, teamId),
                    eq(people.teamId, teamId),
                    eq(taskables.taskableType, "people"),
                    inArray(tasks.id, taskIds),
                    isNull(tasks.deletedAt),
                    isNull(people.deletedAt),
                ),
            )
            .orderBy(asc(taskables.id));

        return rows.map(({ taskId, person }) => ({
            taskId: ulidSchema.parse(taskId),
            id: ulidSchema.parse(person.id),
            teamId: ulidSchema.parse(person.teamId),
            companyId:
                person.companyId === null
                    ? null
                    : ulidSchema.parse(person.companyId),
            name: person.name,
            creationSource: person.creationSource,
            createdAt: person.createdAt,
            updatedAt: person.updatedAt,
        }));
    }

    public async loadOpportunities(
        teamId: Ulid,
        taskIds: readonly Ulid[],
    ): Promise<readonly TaskOpportunityRecord[]> {
        if (taskIds.length === 0) {
            return [];
        }

        const rows = await this.database
            .select({ taskId: taskables.taskId, opportunity: opportunities })
            .from(taskables)
            .innerJoin(
                opportunities,
                eq(opportunities.id, taskables.taskableId),
            )
            .innerJoin(tasks, eq(tasks.id, taskables.taskId))
            .where(
                and(
                    eq(tasks.teamId, teamId),
                    eq(opportunities.teamId, teamId),
                    eq(taskables.taskableType, "opportunity"),
                    inArray(tasks.id, taskIds),
                    isNull(tasks.deletedAt),
                    isNull(opportunities.deletedAt),
                ),
            )
            .orderBy(asc(taskables.id));

        return rows.map(({ taskId, opportunity }) => ({
            taskId: ulidSchema.parse(taskId),
            id: ulidSchema.parse(opportunity.id),
            teamId: ulidSchema.parse(opportunity.teamId),
            companyId:
                opportunity.companyId === null
                    ? null
                    : ulidSchema.parse(opportunity.companyId),
            contactId:
                opportunity.contactId === null
                    ? null
                    : ulidSchema.parse(opportunity.contactId),
            name: opportunity.name,
            creationSource: opportunity.creationSource,
            createdAt: opportunity.createdAt,
            updatedAt: opportunity.updatedAt,
        }));
    }

    public async loadRelationshipCounts(
        teamId: Ulid,
        taskIds: readonly Ulid[],
        includes: readonly TaskCountInclude[],
    ): Promise<ReadonlyMap<Ulid, TaskRelationshipCounts>> {
        const counts = initializeCounts(taskIds);

        if (taskIds.length === 0) {
            return counts;
        }

        if (includes.includes("assigneesCount")) {
            const rows = await this.database
                .select({
                    taskId: taskUser.taskId,
                    count: sql<number>`count(*)::integer`,
                })
                .from(taskUser)
                .innerJoin(tasks, eq(tasks.id, taskUser.taskId))
                .where(
                    and(
                        eq(tasks.teamId, teamId),
                        inArray(tasks.id, taskIds),
                        isNull(tasks.deletedAt),
                    ),
                )
                .groupBy(taskUser.taskId);

            for (const row of rows) {
                setCount(counts, row.taskId, "assigneesCount", row.count);
            }
        }

        const countTaskables = async (
            type: "company" | "people" | "opportunity",
        ): Promise<readonly { taskId: string; count: number }[]> => {
            const relatedExists =
                type === "company"
                    ? exists(
                          this.database
                              .select({ id: companies.id })
                              .from(companies)
                              .where(
                                  and(
                                      eq(companies.id, taskables.taskableId),
                                      eq(companies.teamId, teamId),
                                      isNull(companies.deletedAt),
                                  ),
                              ),
                      )
                    : type === "people"
                      ? exists(
                            this.database
                                .select({ id: people.id })
                                .from(people)
                                .where(
                                    and(
                                        eq(people.id, taskables.taskableId),
                                        eq(people.teamId, teamId),
                                        isNull(people.deletedAt),
                                    ),
                                ),
                        )
                      : exists(
                            this.database
                                .select({ id: opportunities.id })
                                .from(opportunities)
                                .where(
                                    and(
                                        eq(
                                            opportunities.id,
                                            taskables.taskableId,
                                        ),
                                        eq(opportunities.teamId, teamId),
                                        isNull(opportunities.deletedAt),
                                    ),
                                ),
                        );

            return this.database
                .select({
                    taskId: taskables.taskId,
                    count: sql<number>`count(*)::integer`,
                })
                .from(taskables)
                .innerJoin(tasks, eq(tasks.id, taskables.taskId))
                .where(
                    and(
                        eq(tasks.teamId, teamId),
                        eq(taskables.taskableType, type),
                        inArray(tasks.id, taskIds),
                        isNull(tasks.deletedAt),
                        relatedExists,
                    ),
                )
                .groupBy(taskables.taskId);
        };

        if (includes.includes("companiesCount")) {
            for (const row of await countTaskables("company")) {
                setCount(counts, row.taskId, "companiesCount", row.count);
            }
        }
        if (includes.includes("peopleCount")) {
            for (const row of await countTaskables("people")) {
                setCount(counts, row.taskId, "peopleCount", row.count);
            }
        }
        if (includes.includes("opportunitiesCount")) {
            for (const row of await countTaskables("opportunity")) {
                setCount(counts, row.taskId, "opportunitiesCount", row.count);
            }
        }

        for (const taskId of taskIds) {
            const current = counts.get(taskId) ?? {};
            counts.set(taskId, {
                ...(includes.includes("assigneesCount")
                    ? { assigneesCount: current.assigneesCount ?? 0 }
                    : {}),
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

    private async loadQueryCustomFields(
        teamId: Ulid,
        query: TaskListQuery,
    ): Promise<ReadonlyMap<string, TaskQueryCustomField>> {
        const requestedCodes = [
            ...query.filters.customFields.map(({ code }) => code),
            ...query.sorts
                .filter(({ field }) => !builtInSorts.has(field))
                .map(({ field }) => field),
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
                    eq(customFields.entityType, "task"),
                    eq(customFields.active, true),
                    inArray(customFields.code, [...new Set(requestedCodes)]),
                ),
            );
        const fields = new Map<string, TaskQueryCustomField>();

        for (const row of rows) {
            if (
                !filterableTypes.has(row.type as CustomFieldType) ||
                isEncrypted(row.settings)
            ) {
                continue;
            }

            fields.set(row.code, {
                id: ulidSchema.parse(row.id),
                code: row.code,
                type: row.type as CustomFieldType,
            });
        }

        for (const sort of query.sorts) {
            if (!builtInSorts.has(sort.field) && !fields.has(sort.field)) {
                throw new ApiBadRequestError(
                    `Requested sort ${sort.field} is not allowed.`,
                );
            }
        }

        return fields;
    }
}
