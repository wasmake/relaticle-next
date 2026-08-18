import { ApiNotFoundError } from "@/server/api/errors";
import type { RequestContext } from "@/server/context/request-context";
import type {
    CustomFieldsApiObject,
    CustomFieldWriteRequest,
    PreparedCustomFieldWrite,
} from "@/server/custom-fields/types";
import { createUlid, type Ulid } from "@/server/ids";

import type { TaskAssigneeNotificationPort } from "./notifications";
import type { TasksRepository, TaskMutationResult } from "./repository";
import type {
    TaskCompanyRecord,
    TaskCompanyView,
    TaskInclude,
    TaskListQuery,
    TaskListView,
    TaskOpportunityRecord,
    TaskOpportunityView,
    TaskPersonRecord,
    TaskPersonView,
    TaskRecord,
    TaskRelationshipCounts,
    TaskUserRecord,
    TaskUserRelationship,
    TaskView,
} from "./types";
import { taskCountIncludes } from "./types";
import { validateCreateTask, validateUpdateTask } from "./validation";

export interface TaskCustomFieldsService {
    prepareWrite(
        context: Pick<RequestContext, "teamId">,
        request: CustomFieldWriteRequest,
    ): Promise<PreparedCustomFieldWrite>;
    format(
        context: Pick<RequestContext, "teamId">,
        entityType: "task" | "company" | "people" | "opportunity",
        entityId: Ulid,
    ): Promise<CustomFieldsApiObject>;
}

const relationshipKeys = [
    "companyIds",
    "peopleIds",
    "opportunityIds",
    "assigneeIds",
] as const;

const groupByTask = <T extends Readonly<{ taskId: Ulid }>>(
    records: readonly T[],
): ReadonlyMap<Ulid, readonly T[]> => {
    const grouped = new Map<Ulid, T[]>();

    for (const record of records) {
        const taskRecords = grouped.get(record.taskId) ?? [];
        taskRecords.push(record);
        grouped.set(record.taskId, taskRecords);
    }

    return grouped;
};

const groupViewsByTask = <T extends Readonly<{ record: { taskId: Ulid } }>>(
    views: readonly T[],
): ReadonlyMap<Ulid, readonly T[]> => {
    const grouped = new Map<Ulid, T[]>();

    for (const view of views) {
        const taskViews = grouped.get(view.record.taskId) ?? [];
        taskViews.push(view);
        grouped.set(view.record.taskId, taskViews);
    }

    return grouped;
};

const assertPreparedWrite = (
    context: RequestContext,
    taskId: Ulid,
    prepared: PreparedCustomFieldWrite,
): void => {
    const invalidMutation = prepared.mutations.some(
        (mutation) =>
            mutation.teamId !== context.teamId ||
            mutation.entityType !== "task" ||
            mutation.entityId !== taskId,
    );
    const invalidPromotion = prepared.optionPromotions.some(
        (promotion) => promotion.teamId !== context.teamId,
    );

    if (
        prepared.teamId !== context.teamId ||
        prepared.entityType !== "task" ||
        prepared.entityId !== taskId ||
        invalidMutation ||
        invalidPromotion
    ) {
        throw new Error(
            "Prepared custom fields do not match the task transaction.",
        );
    }
};

export class TasksService {
    public constructor(
        private readonly repository: TasksRepository,
        private readonly customFields: TaskCustomFieldsService,
        private readonly notifications: TaskAssigneeNotificationPort,
        private readonly now: () => Date = () => new Date(),
        private readonly createId: () => Ulid = createUlid,
    ) {}

    public async list(
        context: RequestContext,
        query: TaskListQuery,
    ): Promise<TaskListView> {
        const page = await this.repository.list(
            context.teamId,
            context.userId,
            query,
        );

        return {
            tasks: await this.loadViews(context, page.records, query.includes),
            page: query.page,
            perPage: query.perPage,
            total: page.total,
        };
    }

    public async show(
        context: RequestContext,
        taskId: Ulid,
        includes: readonly TaskInclude[],
    ): Promise<TaskView> {
        const task = await this.repository.find(context.teamId, taskId);

        if (task === undefined) {
            throw new ApiNotFoundError();
        }

        const [view] = await this.loadViews(context, [task], includes);

        if (view === undefined) {
            throw new ApiNotFoundError();
        }

        return view;
    }

    public async create(
        context: RequestContext,
        body: Readonly<Record<string, unknown>>,
        includes: readonly TaskInclude[],
    ): Promise<TaskView> {
        const data = validateCreateTask(body);
        const id = this.createId();
        const customFields = await this.customFields.prepareWrite(context, {
            entityType: "task",
            entityId: id,
            operation: "create",
            ...(Object.hasOwn(data, "customFields")
                ? { customFields: data.customFields }
                : {}),
        });
        assertPreparedWrite(context, id, customFields);

        const result = await this.repository.create({
            id,
            teamId: context.teamId,
            creatorId: context.userId,
            title: data.title,
            creationSource: "api",
            occurredAt: this.now(),
            customFields,
            ...this.relationshipInput(data),
        });
        await this.notifyNewAssignees(context, result);

        const [view] = await this.loadViews(context, [result.record], includes);

        if (view === undefined) {
            throw new Error("The created task could not be loaded.");
        }

        return view;
    }

    public async update(
        context: RequestContext,
        taskId: Ulid,
        body: Readonly<Record<string, unknown>>,
        includes: readonly TaskInclude[],
    ): Promise<TaskView> {
        const existing = await this.repository.find(context.teamId, taskId);

        if (existing === undefined) {
            throw new ApiNotFoundError();
        }

        const data = validateUpdateTask(body);
        const hasCustomFields = Object.hasOwn(data, "customFields");
        const customFields = hasCustomFields
            ? await this.customFields.prepareWrite(context, {
                  entityType: "task",
                  entityId: taskId,
                  operation: "update",
                  customFields: data.customFields,
              })
            : undefined;

        if (customFields !== undefined) {
            assertPreparedWrite(context, taskId, customFields);
        }

        const relationships = this.relationshipInput(data);
        const hasRelationships = relationshipKeys.some((key) =>
            Object.hasOwn(relationships, key),
        );
        let task = existing;

        if (
            data.title !== undefined ||
            customFields !== undefined ||
            hasRelationships
        ) {
            const result = await this.repository.update(
                {
                    id: taskId,
                    teamId: context.teamId,
                    occurredAt: this.now(),
                    ...(data.title === undefined ? {} : { title: data.title }),
                    ...(customFields === undefined ? {} : { customFields }),
                    ...relationships,
                },
                context.userId,
            );

            if (result === undefined) {
                throw new ApiNotFoundError();
            }

            await this.notifyNewAssignees(context, result);
            task = result.record;
        }

        const [view] = await this.loadViews(context, [task], includes);

        if (view === undefined) {
            throw new ApiNotFoundError();
        }

        return view;
    }

    public async delete(context: RequestContext, taskId: Ulid): Promise<void> {
        const existing = await this.repository.find(context.teamId, taskId);

        if (existing === undefined) {
            throw new ApiNotFoundError();
        }

        const deleted = await this.repository.softDelete(
            context.teamId,
            taskId,
            this.now(),
            context.userId,
        );

        if (!deleted) {
            throw new ApiNotFoundError();
        }
    }

    private relationshipInput(
        data: Readonly<{
            companyIds?: readonly Ulid[];
            peopleIds?: readonly Ulid[];
            opportunityIds?: readonly Ulid[];
            assigneeIds?: readonly Ulid[];
        }>,
    ): Readonly<{
        companyIds?: readonly Ulid[];
        peopleIds?: readonly Ulid[];
        opportunityIds?: readonly Ulid[];
        assigneeIds?: readonly Ulid[];
    }> {
        return {
            ...(Object.hasOwn(data, "companyIds")
                ? { companyIds: data.companyIds ?? [] }
                : {}),
            ...(Object.hasOwn(data, "peopleIds")
                ? { peopleIds: data.peopleIds ?? [] }
                : {}),
            ...(Object.hasOwn(data, "opportunityIds")
                ? { opportunityIds: data.opportunityIds ?? [] }
                : {}),
            ...(Object.hasOwn(data, "assigneeIds")
                ? { assigneeIds: data.assigneeIds ?? [] }
                : {}),
        };
    }

    private async notifyNewAssignees(
        context: RequestContext,
        result: TaskMutationResult,
    ): Promise<void> {
        if (result.newAssigneeIds.length === 0) {
            return;
        }

        await this.notifications.dispatchAfterCommit({
            teamId: context.teamId,
            taskId: result.record.id,
            taskTitle: result.record.title,
            recipientIds: result.newAssigneeIds,
        });
    }

    private async loadViews(
        context: RequestContext,
        tasks: readonly TaskRecord[],
        includes: readonly TaskInclude[],
    ): Promise<readonly TaskView[]> {
        if (tasks.length === 0) {
            return [];
        }

        const includeSet = new Set(includes);
        const taskIds = tasks.map((task) => task.id);
        const creators = includeSet.has("creator")
            ? await this.repository.loadCreators(context.teamId, tasks)
            : [];
        const creatorsById = new Map<Ulid, TaskUserRecord>(
            creators.map((creator) => [creator.id, creator]),
        );
        const assignees = includeSet.has("assignees")
            ? await this.repository.loadAssignees(context.teamId, taskIds)
            : [];
        const assigneesByTask = groupByTask<TaskUserRelationship>(assignees);
        const companies = includeSet.has("companies")
            ? await this.loadCompanies(context, taskIds)
            : [];
        const companiesByTask = groupViewsByTask(companies);
        const people = includeSet.has("people")
            ? await this.loadPeople(context, taskIds)
            : [];
        const peopleByTask = groupViewsByTask(people);
        const opportunities = includeSet.has("opportunities")
            ? await this.loadOpportunities(context, taskIds)
            : [];
        const opportunitiesByTask = groupViewsByTask(opportunities);
        const countIncludes = taskCountIncludes.filter((include) =>
            includeSet.has(include),
        );
        const counts =
            countIncludes.length === 0
                ? new Map<Ulid, TaskRelationshipCounts>()
                : await this.repository.loadRelationshipCounts(
                      context.teamId,
                      taskIds,
                      countIncludes,
                  );
        const formattedCustomFields = await Promise.all(
            tasks.map((task) =>
                this.customFields.format(context, "task", task.id),
            ),
        );

        return tasks.map((task, index): TaskView => ({
            record: task,
            customFields: formattedCustomFields[index] ?? {},
            ...(includeSet.has("creator")
                ? {
                      creator:
                          task.creatorId === null
                              ? null
                              : (creatorsById.get(task.creatorId) ?? null),
                  }
                : {}),
            ...(includeSet.has("assignees")
                ? {
                      assignees: (assigneesByTask.get(task.id) ?? []).map(
                          ({ user }) => user,
                      ),
                  }
                : {}),
            ...(includeSet.has("companies")
                ? {
                      companies: companiesByTask.get(task.id) ?? [],
                  }
                : {}),
            ...(includeSet.has("people")
                ? {
                      people: peopleByTask.get(task.id) ?? [],
                  }
                : {}),
            ...(includeSet.has("opportunities")
                ? {
                      opportunities: opportunitiesByTask.get(task.id) ?? [],
                  }
                : {}),
            counts: counts.get(task.id) ?? {},
        }));
    }

    private async loadCompanies(
        context: RequestContext,
        taskIds: readonly Ulid[],
    ): Promise<readonly TaskCompanyView[]> {
        const companies = await this.repository.loadCompanies(
            context.teamId,
            taskIds,
        );

        return Promise.all(
            companies.map(async (record: TaskCompanyRecord) => ({
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
        taskIds: readonly Ulid[],
    ): Promise<readonly TaskPersonView[]> {
        const people = await this.repository.loadPeople(
            context.teamId,
            taskIds,
        );

        return Promise.all(
            people.map(async (record: TaskPersonRecord) => ({
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
        taskIds: readonly Ulid[],
    ): Promise<readonly TaskOpportunityView[]> {
        const opportunities = await this.repository.loadOpportunities(
            context.teamId,
            taskIds,
        );

        return Promise.all(
            opportunities.map(async (record: TaskOpportunityRecord) => ({
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
