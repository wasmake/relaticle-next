import type { PreparedCustomFieldWrite } from "@/server/custom-fields/types";
import type { Ulid } from "@/server/ids";

import type {
    CompanyCountInclude,
    CompanyListPage,
    CompanyListQuery,
    CompanyOpportunityRecord,
    CompanyPersonRecord,
    CompanyRecord,
    CompanyRelationshipCounts,
    CompanyUserRecord,
} from "./types";

export type CreateCompanyTransaction = Readonly<{
    id: Ulid;
    teamId: Ulid;
    creatorId: Ulid;
    name: string;
    creationSource: "api" | "chat";
    occurredAt: Date;
    customFields: PreparedCustomFieldWrite;
}>;

export type UpdateCompanyTransaction = Readonly<{
    id: Ulid;
    teamId: Ulid;
    occurredAt: Date;
    name?: string;
    customFields?: PreparedCustomFieldWrite;
}>;

export interface CompaniesRepository {
    list(teamId: Ulid, query: CompanyListQuery): Promise<CompanyListPage>;
    find(teamId: Ulid, companyId: Ulid): Promise<CompanyRecord | undefined>;
    create(input: CreateCompanyTransaction): Promise<CompanyRecord>;
    update(
        input: UpdateCompanyTransaction,
        causerId: Ulid,
    ): Promise<CompanyRecord | undefined>;
    softDelete(
        teamId: Ulid,
        companyId: Ulid,
        occurredAt: Date,
        causerId: Ulid,
    ): Promise<boolean>;
    loadUsers(
        teamId: Ulid,
        companies: readonly CompanyRecord[],
        relationships: readonly ("creator" | "accountOwner")[],
    ): Promise<readonly CompanyUserRecord[]>;
    loadPeople(
        teamId: Ulid,
        companyIds: readonly Ulid[],
    ): Promise<readonly CompanyPersonRecord[]>;
    loadOpportunities(
        teamId: Ulid,
        companyIds: readonly Ulid[],
    ): Promise<readonly CompanyOpportunityRecord[]>;
    loadRelationshipCounts(
        teamId: Ulid,
        companyIds: readonly Ulid[],
        includes: readonly CompanyCountInclude[],
    ): Promise<ReadonlyMap<Ulid, CompanyRelationshipCounts>>;
}
