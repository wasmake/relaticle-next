import type { PreparedCustomFieldWrite } from "@/server/custom-fields/types";
import type { Ulid } from "@/server/ids";

import type {
    PeopleCompanyRecord,
    PeopleCountInclude,
    PeopleListPage,
    PeopleListQuery,
    PeopleRecord,
    PeopleRelationshipCounts,
    PeopleUserRecord,
} from "./types";

export type CreatePeopleTransaction = Readonly<{
    id: Ulid;
    teamId: Ulid;
    creatorId: Ulid;
    companyId: Ulid | null;
    name: string;
    creationSource: "api" | "chat";
    occurredAt: Date;
    customFields: PreparedCustomFieldWrite;
}>;

export type UpdatePeopleTransaction = Readonly<{
    id: Ulid;
    teamId: Ulid;
    occurredAt: Date;
    name?: string;
    companyId?: Ulid | null;
    customFields?: PreparedCustomFieldWrite;
}>;

export interface PeopleRepository {
    list(teamId: Ulid, query: PeopleListQuery): Promise<PeopleListPage>;
    find(teamId: Ulid, personId: Ulid): Promise<PeopleRecord | undefined>;
    companyExists(teamId: Ulid, companyId: Ulid): Promise<boolean>;
    create(input: CreatePeopleTransaction): Promise<PeopleRecord>;
    update(
        input: UpdatePeopleTransaction,
        causerId: Ulid,
    ): Promise<PeopleRecord | undefined>;
    softDelete(
        teamId: Ulid,
        personId: Ulid,
        occurredAt: Date,
        causerId: Ulid,
    ): Promise<boolean>;
    loadUsers(
        teamId: Ulid,
        people: readonly PeopleRecord[],
    ): Promise<readonly PeopleUserRecord[]>;
    loadCompanies(
        teamId: Ulid,
        companyIds: readonly Ulid[],
    ): Promise<readonly PeopleCompanyRecord[]>;
    loadRelationshipCounts(
        teamId: Ulid,
        personIds: readonly Ulid[],
        includes: readonly PeopleCountInclude[],
    ): Promise<ReadonlyMap<Ulid, PeopleRelationshipCounts>>;
}
