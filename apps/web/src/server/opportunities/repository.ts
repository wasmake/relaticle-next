import type { PreparedCustomFieldWrite } from "@/server/custom-fields/types";
import type { Ulid } from "@/server/ids";

import type {
    OpportunityCompanyRecord,
    OpportunityContactRecord,
    OpportunityCountInclude,
    OpportunityListPage,
    OpportunityListQuery,
    OpportunityRecord,
    OpportunityRelationshipCounts,
    OpportunityUserRecord,
} from "./types";

export type OpportunityForeignKeys = Readonly<{
    companyId?: Ulid | null;
    contactId?: Ulid | null;
}>;

export type OpportunityForeignKey = "company_id" | "contact_id";

export type CreateOpportunityTransaction = Readonly<{
    id: Ulid;
    teamId: Ulid;
    creatorId: Ulid;
    companyId: Ulid | null;
    contactId: Ulid | null;
    name: string;
    creationSource: "api";
    occurredAt: Date;
    customFields: PreparedCustomFieldWrite;
}>;

export type UpdateOpportunityTransaction = Readonly<{
    id: Ulid;
    teamId: Ulid;
    occurredAt: Date;
    name?: string;
    companyId?: Ulid | null;
    contactId?: Ulid | null;
    customFields?: PreparedCustomFieldWrite;
}>;

export interface OpportunitiesRepository {
    list(
        teamId: Ulid,
        query: OpportunityListQuery,
    ): Promise<OpportunityListPage>;
    find(
        teamId: Ulid,
        opportunityId: Ulid,
    ): Promise<OpportunityRecord | undefined>;
    invalidForeignKeys(
        teamId: Ulid,
        foreignKeys: OpportunityForeignKeys,
    ): Promise<readonly OpportunityForeignKey[]>;
    create(input: CreateOpportunityTransaction): Promise<OpportunityRecord>;
    update(
        input: UpdateOpportunityTransaction,
        causerId: Ulid,
    ): Promise<OpportunityRecord | undefined>;
    softDelete(
        teamId: Ulid,
        opportunityId: Ulid,
        occurredAt: Date,
        causerId: Ulid,
    ): Promise<boolean>;
    loadUsers(
        teamId: Ulid,
        opportunities: readonly OpportunityRecord[],
    ): Promise<readonly OpportunityUserRecord[]>;
    loadCompanies(
        teamId: Ulid,
        companyIds: readonly Ulid[],
    ): Promise<readonly OpportunityCompanyRecord[]>;
    loadContacts(
        teamId: Ulid,
        contactIds: readonly Ulid[],
    ): Promise<readonly OpportunityContactRecord[]>;
    loadRelationshipCounts(
        teamId: Ulid,
        opportunityIds: readonly Ulid[],
        includes: readonly OpportunityCountInclude[],
    ): Promise<ReadonlyMap<Ulid, OpportunityRelationshipCounts>>;
}
