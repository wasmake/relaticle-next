import { describe, expect, it } from "vitest";

import { ApiValidationError } from "@/server/api/errors";
import {
    apiAccessFromHttpAuthResult,
    type ApiAccessResolver,
} from "@/server/api/http";
import type { ApiAccessResult } from "@/server/api/access";
import type { HttpAuthResult } from "@/server/auth/http";
import {
    createRequestContext,
    type RequestContext,
} from "@/server/context/request-context";
import type {
    CustomFieldsApiObject,
    CustomFieldStorageValues,
    CustomFieldValueMutation,
    CustomFieldWriteRequest,
    PreparedCustomFieldWrite,
} from "@/server/custom-fields/types";
import { CustomFieldValidationError } from "@/server/custom-fields/types";
import { ulidSchema, type Ulid } from "@/server/ids";
import {
    handleTaskRequest,
    handleTasksCollectionRequest,
    type TasksApiDependencies,
} from "@/server/tasks/handler";
import type {
    NewTaskAssigneesNotification,
    TaskAssigneeNotificationPort,
} from "@/server/tasks/notifications";
import { BullMqTaskAssigneeNotificationPort } from "@/server/tasks/notifications";
import { parseTaskListQuery } from "@/server/tasks/query";
import type {
    CreateTaskTransaction,
    TasksRepository,
    TaskMutationResult,
    UpdateTaskTransaction,
} from "@/server/tasks/repository";
import {
    TasksService,
    type TaskCustomFieldsService,
} from "@/server/tasks/service";
import type {
    TaskCompanyRecord,
    TaskCountInclude,
    TaskListPage,
    TaskListQuery,
    TaskOpportunityRecord,
    TaskPersonRecord,
    TaskRecord,
    TaskRelationshipCounts,
    TaskRelationshipIds,
    TaskUserRecord,
    TaskUserRelationship,
} from "@/server/tasks/types";

const ulid = (sequence: number): Ulid =>
    ulidSchema.parse(`01J${sequence.toString().padStart(23, "0")}`);

const userId = ulid(1);
const teamId = ulid(2);
const otherTeamId = ulid(3);
const taskId = ulid(4);
const otherTaskId = ulid(5);
const companyId = ulid(6);
const personId = ulid(7);
const opportunityId = ulid(8);
const assigneeId = ulid(9);
const secondAssigneeId = ulid(10);
const foreignCompanyId = ulid(11);
const foreignPersonId = ulid(12);
const foreignOpportunityId = ulid(13);
const foreignAssigneeId = ulid(14);
const customFieldId = ulid(15);
const customFieldValueId = ulid(16);
const now = new Date("2026-08-18T12:00:00.000Z");

const requestContext = (
    abilities:
        readonly ("read" | "create" | "update" | "delete")[] | null = null,
): RequestContext =>
    createRequestContext({
        requestId: "request-1",
        userId,
        teamId,
        credential:
            abilities === null
                ? { kind: "session", sessionId: "session-1" }
                : {
                      kind: "personal_access_token",
                      tokenId: "1",
                      abilities: [...abilities],
                  },
    });

const authenticated = (
    context: RequestContext = requestContext(),
): HttpAuthResult => ({
    ok: true,
    context,
    user: { id: userId, name: "Ada Lovelace", email: "ada@example.test" },
    team: {
        id: teamId,
        name: "Analytical Engines",
        slug: "analytical-engines",
        personalTeam: false,
    },
});

class StaticAuthResolver implements ApiAccessResolver {
    public constructor(private readonly result: HttpAuthResult) {}

    public async resolve(): Promise<ApiAccessResult> {
        return apiAccessFromHttpAuthResult(this.result);
    }
}

const emptyStorage = (): CustomFieldStorageValues => ({
    stringValue: null,
    textValue: null,
    booleanValue: null,
    integerValue: null,
    floatValue: null,
    dateValue: null,
    datetimeValue: null,
    jsonValue: null,
});

class InMemoryTaskCustomFields implements TaskCustomFieldsService {
    public readonly prepareCalls: CustomFieldWriteRequest[] = [];
    private readonly values = new Map<Ulid, CustomFieldsApiObject>();

    public async prepareWrite(
        context: Pick<RequestContext, "teamId">,
        request: CustomFieldWriteRequest,
    ): Promise<PreparedCustomFieldWrite> {
        this.prepareCalls.push(request);

        if (
            request.customFields !== undefined &&
            (typeof request.customFields !== "object" ||
                request.customFields === null ||
                Array.isArray(request.customFields))
        ) {
            throw new CustomFieldValidationError([
                { path: "custom_fields", message: "must be an object." },
            ]);
        }

        const submitted = (request.customFields ?? {}) as Readonly<
            Record<string, unknown>
        >;
        const unknown = Object.keys(submitted).filter(
            (code) => code !== "priority",
        );

        if (unknown.length > 0) {
            throw new CustomFieldValidationError([
                {
                    path: "custom_fields",
                    message: `Unknown custom field keys: ${unknown.join(", ")}.`,
                },
            ]);
        }

        const existing = this.values.get(request.entityId) ?? {};
        const next = Object.hasOwn(submitted, "priority")
            ? { ...existing, priority: submitted.priority as string | null }
            : existing;
        this.values.set(request.entityId, next);

        const mutations: readonly CustomFieldValueMutation[] = Object.hasOwn(
            submitted,
            "priority",
        )
            ? [
                  {
                      id: customFieldValueId,
                      teamId: context.teamId,
                      entityType: "task",
                      entityId: request.entityId,
                      customFieldId,
                      ...emptyStorage(),
                      textValue:
                          typeof submitted.priority === "string"
                              ? submitted.priority
                              : null,
                  },
              ]
            : [];

        return {
            teamId: context.teamId,
            entityType: "task",
            entityId: request.entityId,
            mutations,
            optionPromotions: [],
        };
    }

    public async format(
        _context: Pick<RequestContext, "teamId">,
        _entityType: "task" | "company" | "people" | "opportunity",
        entityId: Ulid,
    ): Promise<CustomFieldsApiObject> {
        return this.values.get(entityId) ?? {};
    }
}

class RecordingNotifications implements TaskAssigneeNotificationPort {
    public readonly calls: NewTaskAssigneesNotification[] = [];

    public constructor(private readonly events: string[] = []) {}

    public async dispatchAfterCommit(
        notification: NewTaskAssigneesNotification,
    ): Promise<void> {
        this.events.push("notify");
        this.calls.push(notification);
    }
}

const task = (overrides: Partial<TaskRecord> = {}): TaskRecord => ({
    id: taskId,
    teamId,
    creatorId: userId,
    title: "Follow up",
    creationSource: "api",
    createdAt: now,
    updatedAt: now,
    ...overrides,
});

const relationshipMap = (): Map<Ulid, Set<Ulid>> => new Map();

class InMemoryTasksRepository implements TasksRepository {
    public readonly createInputs: CreateTaskTransaction[] = [];
    public readonly updateInputs: UpdateTaskTransaction[] = [];
    public readonly deleted: Ulid[] = [];
    public readonly records: TaskRecord[];
    public readonly companyIds = relationshipMap();
    public readonly peopleIds = relationshipMap();
    public readonly opportunityIds = relationshipMap();
    public readonly assigneeIds = relationshipMap();
    public readonly events: string[] = [];
    public readonly validCompanyIds = new Set<Ulid>([companyId]);
    public readonly validPeopleIds = new Set<Ulid>([personId]);
    public readonly validOpportunityIds = new Set<Ulid>([opportunityId]);
    public readonly validAssigneeIds = new Set<Ulid>([
        userId,
        assigneeId,
        secondAssigneeId,
    ]);
    public failTransaction = false;
    public users: TaskUserRecord[] = [
        { id: userId, name: "Ada Lovelace", email: "ada@example.test" },
        { id: assigneeId, name: "Grace Hopper", email: "grace@example.test" },
        {
            id: secondAssigneeId,
            name: "Katherine Johnson",
            email: "katherine@example.test",
        },
    ];

    public constructor(records: readonly TaskRecord[] = []) {
        this.records = [...records];
    }

    public async list(
        requestedTeamId: Ulid,
        requestedUserId: Ulid,
        query: TaskListQuery,
    ): Promise<TaskListPage> {
        let records = this.records.filter(
            (record) =>
                record.teamId === requestedTeamId &&
                !this.deleted.includes(record.id),
        );

        if (query.filters.title !== undefined) {
            const title = query.filters.title.toLocaleLowerCase();
            records = records.filter((record) =>
                record.title.toLocaleLowerCase().includes(title),
            );
        }

        if (query.filters.assignedToMe === true) {
            records = records.filter((record) =>
                this.assigneeIds.get(record.id)?.has(requestedUserId),
            );
        }

        if (
            query.filters.assigneeIds !== undefined &&
            query.filters.assigneeIds.length > 0
        ) {
            records = records.filter((record) =>
                query.filters.assigneeIds?.some((id) =>
                    this.assigneeIds.get(record.id)?.has(id as Ulid),
                ),
            );
        }

        const relatedFilters = [
            [query.filters.companyId, this.companyIds],
            [query.filters.peopleId, this.peopleIds],
            [query.filters.opportunityId, this.opportunityIds],
        ] as const;

        for (const [id, relationships] of relatedFilters) {
            if (id !== undefined) {
                records = records.filter((record) =>
                    relationships.get(record.id)?.has(id as Ulid),
                );
            }
        }

        for (const sort of [...query.sorts].reverse()) {
            records.sort((left, right) => {
                const leftValue =
                    sort.field === "title"
                        ? left.title
                        : sort.field === "updated_at"
                          ? left.updatedAt?.toISOString()
                          : left.createdAt?.toISOString();
                const rightValue =
                    sort.field === "title"
                        ? right.title
                        : sort.field === "updated_at"
                          ? right.updatedAt?.toISOString()
                          : right.createdAt?.toISOString();
                const comparison = String(leftValue).localeCompare(
                    String(rightValue),
                );

                return sort.direction === "asc" ? comparison : -comparison;
            });
        }

        const total = records.length;
        const start = (query.page - 1) * query.perPage;

        return {
            records: records.slice(start, start + query.perPage),
            total,
        };
    }

    public async find(
        requestedTeamId: Ulid,
        requestedTaskId: Ulid,
    ): Promise<TaskRecord | undefined> {
        return this.records.find(
            (record) =>
                record.id === requestedTaskId &&
                record.teamId === requestedTeamId &&
                !this.deleted.includes(record.id),
        );
    }

    public async create(
        input: CreateTaskTransaction,
    ): Promise<TaskMutationResult> {
        this.createInputs.push(input);
        this.assertReferences(input);

        if (this.failTransaction) {
            throw new Error("transaction failed");
        }

        const record = task({
            id: input.id,
            teamId: input.teamId,
            creatorId: input.creatorId,
            title: input.title,
            creationSource: input.creationSource,
            createdAt: input.occurredAt,
            updatedAt: input.occurredAt,
        });
        this.records.push(record);
        this.applyRelationships(input.id, input);
        this.events.push("commit");

        return {
            record,
            newAssigneeIds: [...new Set(input.assigneeIds ?? [])],
        };
    }

    public async update(
        input: UpdateTaskTransaction,
    ): Promise<TaskMutationResult | undefined> {
        this.updateInputs.push(input);
        const index = this.records.findIndex(
            (record) =>
                record.id === input.id &&
                record.teamId === input.teamId &&
                !this.deleted.includes(record.id),
        );
        const existing = this.records[index];

        if (existing === undefined) {
            return undefined;
        }

        this.assertReferences(input);

        if (this.failTransaction) {
            throw new Error("transaction failed");
        }

        const previousAssignees = new Set(this.assigneeIds.get(input.id) ?? []);
        const updated = {
            ...existing,
            ...(input.title === undefined ? {} : { title: input.title }),
            updatedAt: input.occurredAt,
        };
        this.records[index] = updated;
        this.applyRelationships(input.id, input);
        this.events.push("commit");

        return {
            record: updated,
            newAssigneeIds:
                input.assigneeIds === undefined
                    ? []
                    : [...new Set(input.assigneeIds)].filter(
                          (id) => !previousAssignees.has(id),
                      ),
        };
    }

    public async softDelete(
        requestedTeamId: Ulid,
        requestedTaskId: Ulid,
    ): Promise<boolean> {
        const existing = await this.find(requestedTeamId, requestedTaskId);

        if (existing === undefined) {
            return false;
        }

        this.deleted.push(requestedTaskId);

        return true;
    }

    public async loadCreators(
        requestedTeamId: Ulid,
        tasks: readonly TaskRecord[],
    ): Promise<readonly TaskUserRecord[]> {
        const creatorIds = new Set(
            tasks
                .filter((record) => record.teamId === requestedTeamId)
                .map((record) => record.creatorId)
                .filter((id): id is Ulid => id !== null),
        );

        return this.users.filter((user) => creatorIds.has(user.id));
    }

    public async loadAssignees(
        requestedTeamId: Ulid,
        taskIds: readonly Ulid[],
    ): Promise<readonly TaskUserRelationship[]> {
        const relationships: TaskUserRelationship[] = [];

        for (const id of taskIds) {
            const record = await this.find(requestedTeamId, id);

            if (record === undefined) {
                continue;
            }

            for (const userId of this.assigneeIds.get(id) ?? []) {
                const user = this.users.find(
                    (candidate) => candidate.id === userId,
                );

                if (user !== undefined) {
                    relationships.push({ taskId: id, user });
                }
            }
        }

        return relationships;
    }

    public async loadCompanies(
        requestedTeamId: Ulid,
        taskIds: readonly Ulid[],
    ): Promise<readonly TaskCompanyRecord[]> {
        return taskIds.flatMap((requestedTaskId) =>
            [...(this.companyIds.get(requestedTaskId) ?? [])]
                .filter((id) => id === companyId)
                .map((id) => ({
                    taskId: requestedTaskId,
                    id,
                    teamId: requestedTeamId,
                    name: "Acme Corp",
                    creationSource: "api",
                    createdAt: now,
                    updatedAt: now,
                })),
        );
    }

    public async loadPeople(
        requestedTeamId: Ulid,
        taskIds: readonly Ulid[],
    ): Promise<readonly TaskPersonRecord[]> {
        return taskIds.flatMap((requestedTaskId) =>
            [...(this.peopleIds.get(requestedTaskId) ?? [])]
                .filter((id) => id === personId)
                .map((id) => ({
                    taskId: requestedTaskId,
                    id,
                    teamId: requestedTeamId,
                    companyId,
                    name: "Grace Hopper",
                    creationSource: "api",
                    createdAt: now,
                    updatedAt: now,
                })),
        );
    }

    public async loadOpportunities(
        requestedTeamId: Ulid,
        taskIds: readonly Ulid[],
    ): Promise<readonly TaskOpportunityRecord[]> {
        return taskIds.flatMap((requestedTaskId) =>
            [...(this.opportunityIds.get(requestedTaskId) ?? [])]
                .filter((id) => id === opportunityId)
                .map((id) => ({
                    taskId: requestedTaskId,
                    id,
                    teamId: requestedTeamId,
                    companyId,
                    contactId: personId,
                    name: "Analytical Engine Rollout",
                    creationSource: "api",
                    createdAt: now,
                    updatedAt: now,
                })),
        );
    }

    public async loadRelationshipCounts(
        _requestedTeamId: Ulid,
        taskIds: readonly Ulid[],
        includes: readonly TaskCountInclude[],
    ): Promise<ReadonlyMap<Ulid, TaskRelationshipCounts>> {
        return new Map(
            taskIds.map((id) => [
                id,
                {
                    ...(includes.includes("assigneesCount")
                        ? {
                              assigneesCount:
                                  this.assigneeIds.get(id)?.size ?? 0,
                          }
                        : {}),
                    ...(includes.includes("companiesCount")
                        ? { companiesCount: this.companyIds.get(id)?.size ?? 0 }
                        : {}),
                    ...(includes.includes("peopleCount")
                        ? { peopleCount: this.peopleIds.get(id)?.size ?? 0 }
                        : {}),
                    ...(includes.includes("opportunitiesCount")
                        ? {
                              opportunitiesCount:
                                  this.opportunityIds.get(id)?.size ?? 0,
                          }
                        : {}),
                },
            ]),
        );
    }

    private assertReferences(relationships: TaskRelationshipIds): void {
        const fields = [
            ["company_ids", relationships.companyIds, this.validCompanyIds],
            ["people_ids", relationships.peopleIds, this.validPeopleIds],
            [
                "opportunity_ids",
                relationships.opportunityIds,
                this.validOpportunityIds,
            ],
            ["assignee_ids", relationships.assigneeIds, this.validAssigneeIds],
        ] as const;
        const issues: Array<{ path: string; message: string }> = [];

        for (const [field, ids, valid] of fields) {
            ids?.forEach((id, index) => {
                if (!valid.has(id)) {
                    issues.push({
                        path: `${field}.${index}`,
                        message: `The selected ${field}.${index} is invalid.`,
                    });
                }
            });
        }

        if (issues.length > 0) {
            throw new ApiValidationError(issues);
        }
    }

    private applyRelationships(
        requestedTaskId: Ulid,
        relationships: TaskRelationshipIds,
    ): void {
        const fields = [
            [relationships.companyIds, this.companyIds],
            [relationships.peopleIds, this.peopleIds],
            [relationships.opportunityIds, this.opportunityIds],
            [relationships.assigneeIds, this.assigneeIds],
        ] as const;

        for (const [ids, target] of fields) {
            if (ids !== undefined) {
                target.set(requestedTaskId, new Set(ids));
            }
        }
    }
}

const dependencies = (
    repository: InMemoryTasksRepository,
    customFields = new InMemoryTaskCustomFields(),
    notifications = new RecordingNotifications(repository.events),
    authResult: HttpAuthResult = authenticated(),
): TasksApiDependencies => ({
    auth: new StaticAuthResolver(authResult),
    tasks: new TasksService(
        repository,
        customFields,
        notifications,
        () => now,
        () => taskId,
    ),
});

const apiRequest = (path: string, method = "GET", body?: unknown): Request =>
    new Request(`https://crm.example.test${path}`, {
        method,
        headers: {
            "x-request-id": "request-1",
            ...(["GET", "HEAD", "OPTIONS"].includes(method)
                ? {}
                : { "sec-fetch-site": "same-origin" }),
            ...(body === undefined
                ? {}
                : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

describe("Tasks write actions", () => {
    it("passes task, pivots, creator, source, and custom fields as one atomic create input", async () => {
        const repository = new InMemoryTasksRepository();
        const customFields = new InMemoryTaskCustomFields();
        const notifications = new RecordingNotifications(repository.events);
        const response = await handleTasksCollectionRequest(
            apiRequest("/api/v1/tasks", "POST", {
                title: "  Follow up  ",
                team_id: otherTeamId,
                creator_id: foreignAssigneeId,
                company_ids: [companyId],
                people_ids: [personId],
                opportunity_ids: [opportunityId],
                assignee_ids: [assigneeId],
                custom_fields: { priority: "  High  " },
            }),
            dependencies(repository, customFields, notifications),
        );

        expect(response.status).toBe(201);
        expect(repository.createInputs).toHaveLength(1);
        expect(repository.createInputs[0]).toMatchObject({
            id: taskId,
            teamId,
            creatorId: userId,
            title: "Follow up",
            creationSource: "api",
            occurredAt: now,
            companyIds: [companyId],
            peopleIds: [personId],
            opportunityIds: [opportunityId],
            assigneeIds: [assigneeId],
            customFields: {
                teamId,
                entityType: "task",
                entityId: taskId,
                mutations: [
                    expect.objectContaining({
                        teamId,
                        entityType: "task",
                        entityId: taskId,
                        customFieldId,
                        textValue: "High",
                    }),
                ],
            },
        });
        expect(repository.events).toEqual(["commit", "notify"]);
        expect(notifications.calls).toEqual([
            {
                teamId,
                taskId,
                taskTitle: "Follow up",
                recipientIds: [assigneeId],
            },
        ]);
        await expect(response.json()).resolves.toEqual({
            data: {
                id: taskId,
                type: "tasks",
                attributes: {
                    title: "Follow up",
                    creation_source: "api",
                    created_at: "2026-08-18T12:00:00.000000Z",
                    updated_at: "2026-08-18T12:00:00.000000Z",
                    custom_fields: { priority: "High" },
                },
            },
        });
    });

    it("sets, clears, and preserves omitted pivots while notifying only the new-assignee delta", async () => {
        const repository = new InMemoryTasksRepository([task()]);
        repository.companyIds.set(taskId, new Set([companyId]));
        repository.peopleIds.set(taskId, new Set([personId]));
        repository.opportunityIds.set(taskId, new Set([opportunityId]));
        repository.assigneeIds.set(taskId, new Set([assigneeId]));
        const notifications = new RecordingNotifications(repository.events);
        const response = await handleTaskRequest(
            apiRequest(`/api/v1/tasks/${taskId}`, "PATCH", {
                title: "Updated",
                company_ids: [],
                assignee_ids: [assigneeId, secondAssigneeId, secondAssigneeId],
                custom_fields: { priority: null },
            }),
            taskId,
            dependencies(
                repository,
                new InMemoryTaskCustomFields(),
                notifications,
            ),
        );

        expect(response.status).toBe(200);
        expect(repository.updateInputs[0]).toMatchObject({
            title: "Updated",
            companyIds: [],
            assigneeIds: [assigneeId, secondAssigneeId, secondAssigneeId],
        });
        expect(repository.updateInputs[0]).not.toHaveProperty("peopleIds");
        expect(repository.updateInputs[0]).not.toHaveProperty("opportunityIds");
        expect(
            repository.updateInputs[0]?.customFields?.mutations[0],
        ).toMatchObject({ textValue: null });
        expect(repository.companyIds.get(taskId)).toEqual(new Set());
        expect(repository.peopleIds.get(taskId)).toEqual(new Set([personId]));
        expect(repository.opportunityIds.get(taskId)).toEqual(
            new Set([opportunityId]),
        );
        expect(notifications.calls).toEqual([
            {
                teamId,
                taskId,
                taskTitle: "Updated",
                recipientIds: [secondAssigneeId],
            },
        ]);

        const cleared = await handleTaskRequest(
            apiRequest(`/api/v1/tasks/${taskId}`, "PATCH", {
                assignee_ids: null,
            }),
            taskId,
            dependencies(
                repository,
                new InMemoryTaskCustomFields(),
                notifications,
            ),
        );

        expect(cleared.status).toBe(200);
        expect(repository.updateInputs[1]?.assigneeIds).toEqual([]);
        expect(repository.assigneeIds.get(taskId)).toEqual(new Set());
        expect(notifications.calls).toHaveLength(1);
    });

    it("rejects every foreign relationship type inside the transaction boundary", async () => {
        const repository = new InMemoryTasksRepository();
        const notifications = new RecordingNotifications(repository.events);
        const response = await handleTasksCollectionRequest(
            apiRequest("/api/v1/tasks", "POST", {
                title: "Foreign links",
                company_ids: [foreignCompanyId],
                people_ids: [foreignPersonId],
                opportunity_ids: [foreignOpportunityId],
                assignee_ids: [foreignAssigneeId],
            }),
            dependencies(
                repository,
                new InMemoryTaskCustomFields(),
                notifications,
            ),
        );

        expect(response.status).toBe(422);
        await expect(response.json()).resolves.toMatchObject({
            errors: {
                "company_ids.0": [expect.any(String)],
                "people_ids.0": [expect.any(String)],
                "opportunity_ids.0": [expect.any(String)],
                "assignee_ids.0": [expect.any(String)],
            },
        });
        expect(repository.records).toEqual([]);
        expect(repository.events).toEqual([]);
        expect(notifications.calls).toEqual([]);
    });

    it("does not dispatch notifications when the transaction fails", async () => {
        const repository = new InMemoryTasksRepository();
        repository.failTransaction = true;
        const notifications = new RecordingNotifications(repository.events);
        const response = await handleTasksCollectionRequest(
            apiRequest("/api/v1/tasks", "POST", {
                title: "Will roll back",
                assignee_ids: [assigneeId],
            }),
            dependencies(
                repository,
                new InMemoryTaskCustomFields(),
                notifications,
            ),
        );

        expect(response.status).toBe(500);
        expect(repository.records).toEqual([]);
        expect(repository.events).toEqual([]);
        expect(notifications.calls).toEqual([]);
    });

    it("schedules BullMQ notification delivery after the response", async () => {
        const jobs: unknown[] = [];
        const callbacks: Array<() => Promise<void>> = [];
        const notification = {
            teamId,
            taskId,
            taskTitle: "Follow up",
            recipientIds: [assigneeId],
        } as const;
        const uuids = [
            "11111111-1111-4111-8111-111111111111",
            "22222222-2222-4222-8222-222222222222",
        ];
        const port = new BullMqTaskAssigneeNotificationPort(
            {
                add: async (name, data, options): Promise<void> => {
                    jobs.push({ name, data, options });
                },
            },
            (callback) => callbacks.push(callback),
            () => uuids.shift() ?? "00000000-0000-4000-8000-000000000000",
        );

        await port.dispatchAfterCommit(notification);

        expect(jobs).toEqual([]);
        expect(callbacks).toHaveLength(1);
        await callbacks[0]?.();
        expect(jobs).toEqual([
            {
                name: "task.assignees.added",
                data: {
                    version: 1,
                    eventId: "11111111-1111-4111-8111-111111111111",
                    teamId,
                    taskId,
                    taskTitle: "Follow up",
                    recipients: [
                        {
                            userId: assigneeId,
                            databaseNotificationId:
                                "22222222-2222-4222-8222-222222222222",
                        },
                    ],
                },
                options: {
                    jobId:
                        "task-assignees-added-11111111-1111-4111-8111-111111111111",
                },
            },
        ]);
    });
});

describe("Tasks authorization and isolation", () => {
    it("enforces HTTP abilities before invoking a task action", async () => {
        const repository = new InMemoryTasksRepository();
        const response = await handleTasksCollectionRequest(
            apiRequest("/api/v1/tasks", "POST", { title: "Blocked" }),
            dependencies(
                repository,
                new InMemoryTaskCustomFields(),
                new RecordingNotifications(),
                authenticated(requestContext(["read"])),
            ),
        );

        expect(response.status).toBe(403);
        expect(repository.createInputs).toEqual([]);
    });

    it("returns identical 404s for foreign, missing, malformed, and soft-deleted tasks", async () => {
        const repository = new InMemoryTasksRepository([
            task({ id: otherTaskId, teamId: otherTeamId }),
            task(),
        ]);
        const api = dependencies(repository);
        const foreign = await handleTaskRequest(
            apiRequest(`/api/v1/tasks/${otherTaskId}`),
            otherTaskId,
            api,
        );
        const missingId = ulid(77);
        const missing = await handleTaskRequest(
            apiRequest(`/api/v1/tasks/${missingId}`),
            missingId,
            api,
        );
        const malformed = await handleTaskRequest(
            apiRequest("/api/v1/tasks/not-a-ulid"),
            "not-a-ulid",
            api,
        );
        const deleted = await handleTaskRequest(
            apiRequest(`/api/v1/tasks/${taskId}`, "DELETE"),
            taskId,
            api,
        );
        const deletedShow = await handleTaskRequest(
            apiRequest(`/api/v1/tasks/${taskId}`),
            taskId,
            api,
        );

        expect(foreign.status).toBe(404);
        expect(missing.status).toBe(404);
        expect(malformed.status).toBe(404);
        expect(deleted.status).toBe(204);
        expect(await deleted.text()).toBe("");
        expect(deletedShow.status).toBe(404);
        expect(await foreign.text()).toBe(await missing.text());
    });
});

describe("Tasks resources and list contract", () => {
    it("renders requested relationships and counts while leaving defaults sparse", async () => {
        const repository = new InMemoryTasksRepository([task()]);
        repository.companyIds.set(taskId, new Set([companyId]));
        repository.peopleIds.set(taskId, new Set([personId]));
        repository.opportunityIds.set(taskId, new Set([opportunityId]));
        repository.assigneeIds.set(taskId, new Set([assigneeId]));
        const api = dependencies(repository);
        const sparse = await handleTaskRequest(
            apiRequest(`/api/v1/tasks/${taskId}`),
            taskId,
            api,
        );
        const included = await handleTaskRequest(
            apiRequest(
                `/api/v1/tasks/${taskId}?include=creator,assignees,companies,people,opportunities,assigneesCount,companiesCount,peopleCount,opportunitiesCount`,
            ),
            taskId,
            api,
        );
        const sparseDocument = (await sparse.json()) as {
            data: Record<string, unknown>;
            included?: unknown;
        };
        const includedDocument = (await included.json()) as {
            data: {
                attributes: Record<string, unknown>;
                relationships: Record<string, unknown>;
            };
            included: readonly { id: string; type: string }[];
        };

        expect(sparseDocument.data).not.toHaveProperty("relationships");
        expect(sparseDocument).not.toHaveProperty("included");
        expect(includedDocument.data.attributes).toMatchObject({
            assignees_count: 1,
            companies_count: 1,
            people_count: 1,
            opportunities_count: 1,
        });
        expect(includedDocument.data.relationships).toMatchObject({
            creator: { data: { id: userId, type: "users" } },
            assignees: { data: [{ id: assigneeId, type: "users" }] },
            companies: { data: [{ id: companyId, type: "companies" }] },
            people: { data: [{ id: personId, type: "people" }] },
            opportunities: {
                data: [{ id: opportunityId, type: "opportunities" }],
            },
        });
        expect(includedDocument.included).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: userId, type: "users" }),
                expect.objectContaining({ id: assigneeId, type: "users" }),
                expect.objectContaining({ id: companyId, type: "companies" }),
                expect.objectContaining({ id: personId, type: "people" }),
                expect.objectContaining({
                    id: opportunityId,
                    type: "opportunities",
                }),
            ]),
        );
    });

    it("parses task filters, custom fields, includes, sorts, and page pagination", () => {
        expect(
            parseTaskListQuery(
                new URL(
                    `https://crm.example.test/api/v1/tasks?per_page=25&page=2&filter[title]=Follow&filter[assigned_to_me]=true&filter[assignee_ids][0]=${assigneeId}&filter[assignee_ids][1]=${secondAssigneeId}&filter[company_id]=${companyId}&filter[people_id]=${personId}&filter[opportunity_id]=${opportunityId}&filter[created_after]=2026-01-01&filter[created_before]=2026-08-18&filter[custom_fields][priority][eq]=High&sort=title,-priority&include=creator,assigneesCount`,
                ),
            ),
        ).toEqual({
            page: 2,
            perPage: 25,
            filters: {
                title: "Follow",
                assignedToMe: true,
                assigneeIds: [assigneeId, secondAssigneeId],
                companyId,
                peopleId: personId,
                opportunityId,
                createdAfter: "2026-01-01",
                createdBefore: "2026-08-18",
                customFields: [
                    { code: "priority", operator: "eq", operand: "High" },
                ],
            },
            sorts: [
                { field: "title", direction: "asc" },
                { field: "priority", direction: "desc" },
            ],
            includes: ["creator", "assigneesCount"],
        });
    });

    it.each([
        "filter[team_id]=secret",
        "sort=team_id",
        "include=secret",
        "cursor=true",
    ])("rejects unsupported query semantics: %s", async (query) => {
        const response = await handleTasksCollectionRequest(
            apiRequest(`/api/v1/tasks?${query}`),
            dependencies(new InMemoryTasksRepository()),
        );

        expect(response.status).toBe(400);
    });

    it("returns Laravel-style pagination validation and stable page metadata", async () => {
        const invalid = await handleTasksCollectionRequest(
            apiRequest("/api/v1/tasks?per_page=101"),
            dependencies(new InMemoryTasksRepository()),
        );
        const listed = await handleTasksCollectionRequest(
            apiRequest("/api/v1/tasks?per_page=1&page=2"),
            dependencies(
                new InMemoryTasksRepository([
                    task(),
                    task({ id: ulid(55), title: "Second task" }),
                ]),
            ),
        );
        const document = (await listed.json()) as {
            data: readonly unknown[];
            meta: Record<string, unknown>;
        };

        expect(invalid.status).toBe(422);
        await expect(invalid.json()).resolves.toMatchObject({
            errors: { per_page: [expect.stringContaining("100")] },
        });
        expect(document.data).toHaveLength(1);
        expect(document.meta).toMatchObject({
            current_page: 2,
            per_page: 1,
            total: 2,
            from: 2,
            to: 2,
        });
    });
});
