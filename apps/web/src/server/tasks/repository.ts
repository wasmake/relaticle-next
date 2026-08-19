import type { PreparedCustomFieldWrite } from "@/server/custom-fields/types";
import type { Ulid } from "@/server/ids";

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
} from "./types";

export type CreateTaskTransaction = TaskRelationshipIds &
    Readonly<{
        id: Ulid;
        teamId: Ulid;
        creatorId: Ulid;
        title: string;
        creationSource: "api" | "chat";
        occurredAt: Date;
        customFields: PreparedCustomFieldWrite;
    }>;

export type UpdateTaskTransaction = TaskRelationshipIds &
    Readonly<{
        id: Ulid;
        teamId: Ulid;
        occurredAt: Date;
        title?: string;
        customFields?: PreparedCustomFieldWrite;
    }>;

export type TaskMutationResult = Readonly<{
    record: TaskRecord;
    newAssigneeIds: readonly Ulid[];
}>;

export interface TasksRepository {
    list(
        teamId: Ulid,
        userId: Ulid,
        query: TaskListQuery,
    ): Promise<TaskListPage>;
    find(teamId: Ulid, taskId: Ulid): Promise<TaskRecord | undefined>;
    create(input: CreateTaskTransaction): Promise<TaskMutationResult>;
    update(
        input: UpdateTaskTransaction,
        causerId: Ulid,
    ): Promise<TaskMutationResult | undefined>;
    softDelete(
        teamId: Ulid,
        taskId: Ulid,
        occurredAt: Date,
        causerId: Ulid,
    ): Promise<boolean>;
    loadCreators(
        teamId: Ulid,
        tasks: readonly TaskRecord[],
    ): Promise<readonly TaskUserRecord[]>;
    loadAssignees(
        teamId: Ulid,
        taskIds: readonly Ulid[],
    ): Promise<readonly TaskUserRelationship[]>;
    loadCompanies(
        teamId: Ulid,
        taskIds: readonly Ulid[],
    ): Promise<readonly TaskCompanyRecord[]>;
    loadPeople(
        teamId: Ulid,
        taskIds: readonly Ulid[],
    ): Promise<readonly TaskPersonRecord[]>;
    loadOpportunities(
        teamId: Ulid,
        taskIds: readonly Ulid[],
    ): Promise<readonly TaskOpportunityRecord[]>;
    loadRelationshipCounts(
        teamId: Ulid,
        taskIds: readonly Ulid[],
        includes: readonly TaskCountInclude[],
    ): Promise<ReadonlyMap<Ulid, TaskRelationshipCounts>>;
}
