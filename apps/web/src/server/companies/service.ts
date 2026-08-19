import type { RequestContext } from "@/server/context/request-context";
import type {
    CustomFieldsApiObject,
    CustomFieldWriteRequest,
    PreparedCustomFieldWrite,
} from "@/server/custom-fields/types";
import { createUlid, type Ulid } from "@/server/ids";
import { ApiNotFoundError } from "@/server/api/errors";

import type { CompaniesRepository } from "./repository";
import type {
    CompanyInclude,
    CompanyListQuery,
    CompanyListView,
    CompanyOpportunityRecord,
    CompanyOpportunityView,
    CompanyPersonRecord,
    CompanyPersonView,
    CompanyRecord,
    CompanyRelationshipCounts,
    CompanyUserRecord,
    CompanyView,
} from "./types";
import { companyCountIncludes } from "./types";
import {
    validateCreateCompany,
    validateUpdateCompany,
} from "./validation";

export interface CompanyCustomFieldsService {
    prepareWrite(
        context: Pick<RequestContext, "teamId">,
        request: CustomFieldWriteRequest,
    ): Promise<PreparedCustomFieldWrite>;
    format(
        context: Pick<RequestContext, "teamId">,
        entityType: "company" | "people" | "opportunity",
        entityId: Ulid,
    ): Promise<CustomFieldsApiObject>;
}

const groupPeople = (
    people: readonly CompanyPersonView[],
): ReadonlyMap<Ulid, readonly CompanyPersonView[]> => {
    const grouped = new Map<Ulid, CompanyPersonView[]>();

    for (const person of people) {
        const records = grouped.get(person.record.companyId) ?? [];
        records.push(person);
        grouped.set(person.record.companyId, records);
    }

    return grouped;
};

const groupOpportunities = (
    opportunities: readonly CompanyOpportunityView[],
): ReadonlyMap<Ulid, readonly CompanyOpportunityView[]> => {
    const grouped = new Map<Ulid, CompanyOpportunityView[]>();

    for (const opportunity of opportunities) {
        const records = grouped.get(opportunity.record.companyId) ?? [];
        records.push(opportunity);
        grouped.set(opportunity.record.companyId, records);
    }

    return grouped;
};

const assertPreparedWrite = (
    context: RequestContext,
    companyId: Ulid,
    prepared: PreparedCustomFieldWrite,
): void => {
    const invalidMutation = prepared.mutations.some(
        (mutation) =>
            mutation.teamId !== context.teamId ||
            mutation.entityType !== "company" ||
            mutation.entityId !== companyId,
    );
    const invalidPromotion = prepared.optionPromotions.some(
        (promotion) => promotion.teamId !== context.teamId,
    );

    if (
        prepared.teamId !== context.teamId ||
        prepared.entityType !== "company" ||
        prepared.entityId !== companyId ||
        invalidMutation ||
        invalidPromotion
    ) {
        throw new Error("Prepared custom fields do not match the company transaction.");
    }
};

export class CompaniesService {
    public constructor(
        private readonly repository: CompaniesRepository,
        private readonly customFields: CompanyCustomFieldsService,
        private readonly now: () => Date = () => new Date(),
        private readonly createId: () => Ulid = createUlid,
    ) {}

    public async list(
        context: RequestContext,
        query: CompanyListQuery,
    ): Promise<CompanyListView> {
        const page = await this.repository.list(context.teamId, query);

        return {
            companies: await this.loadViews(
                context,
                page.records,
                query.includes,
            ),
            page: query.page,
            perPage: query.perPage,
            total: page.total,
        };
    }

    public async show(
        context: RequestContext,
        companyId: Ulid,
        includes: readonly CompanyInclude[],
    ): Promise<CompanyView> {
        const company = await this.repository.find(context.teamId, companyId);

        if (company === undefined) {
            throw new ApiNotFoundError();
        }

        const [view] = await this.loadViews(context, [company], includes);

        if (view === undefined) {
            throw new ApiNotFoundError();
        }

        return view;
    }

    public async create(
        context: RequestContext,
        body: Readonly<Record<string, unknown>>,
        includes: readonly CompanyInclude[],
        creationSource: "api" | "chat" = "api",
    ): Promise<CompanyView> {
        const data = validateCreateCompany(body);
        const id = this.createId();
        const customFields = await this.customFields.prepareWrite(context, {
            entityType: "company",
            entityId: id,
            operation: "create",
            ...(Object.hasOwn(data, "customFields")
                ? { customFields: data.customFields }
                : {}),
        });
        assertPreparedWrite(context, id, customFields);

        const company = await this.repository.create({
            id,
            teamId: context.teamId,
            creatorId: context.userId,
            name: data.name,
            creationSource,
            occurredAt: this.now(),
            customFields,
        });
        const [view] = await this.loadViews(context, [company], includes);

        if (view === undefined) {
            throw new Error("The created company could not be loaded.");
        }

        return view;
    }

    public async update(
        context: RequestContext,
        companyId: Ulid,
        body: Readonly<Record<string, unknown>>,
        includes: readonly CompanyInclude[],
    ): Promise<CompanyView> {
        const existing = await this.repository.find(context.teamId, companyId);

        if (existing === undefined) {
            throw new ApiNotFoundError();
        }

        const data = validateUpdateCompany(body);
        const hasCustomFields = Object.hasOwn(data, "customFields");
        const customFields = hasCustomFields
            ? await this.customFields.prepareWrite(context, {
                  entityType: "company",
                  entityId: companyId,
                  operation: "update",
                  customFields: data.customFields,
              })
            : undefined;

        if (customFields !== undefined) {
            assertPreparedWrite(context, companyId, customFields);
        }

        let company = existing;

        if (data.name !== undefined || customFields !== undefined) {
            const updated = await this.repository.update(
                {
                    id: companyId,
                    teamId: context.teamId,
                    occurredAt: this.now(),
                    ...(data.name === undefined ? {} : { name: data.name }),
                    ...(customFields === undefined ? {} : { customFields }),
                },
                context.userId,
            );

            if (updated === undefined) {
                throw new ApiNotFoundError();
            }

            company = updated;
        }

        const [view] = await this.loadViews(context, [company], includes);

        if (view === undefined) {
            throw new ApiNotFoundError();
        }

        return view;
    }

    public async delete(
        context: RequestContext,
        companyId: Ulid,
    ): Promise<void> {
        const existing = await this.repository.find(context.teamId, companyId);

        if (existing === undefined) {
            throw new ApiNotFoundError();
        }

        const deleted = await this.repository.softDelete(
            context.teamId,
            companyId,
            this.now(),
            context.userId,
        );

        if (!deleted) {
            throw new ApiNotFoundError();
        }
    }

    private async loadViews(
        context: RequestContext,
        companies: readonly CompanyRecord[],
        includes: readonly CompanyInclude[],
    ): Promise<readonly CompanyView[]> {
        if (companies.length === 0) {
            return [];
        }

        const includeSet = new Set(includes);
        const companyIds = companies.map((company) => company.id);
        const userRelationships = (["creator", "accountOwner"] as const).filter(
            (relationship) => includeSet.has(relationship),
        );
        const users =
            userRelationships.length === 0
                ? []
                : await this.repository.loadUsers(
                      context.teamId,
                      companies,
                      userRelationships,
                  );
        const usersById = new Map<Ulid, CompanyUserRecord>(
            users.map((user) => [user.id, user]),
        );
        const people = includeSet.has("people")
            ? await this.loadPeople(context, companyIds)
            : [];
        const opportunities = includeSet.has("opportunities")
            ? await this.loadOpportunities(context, companyIds)
            : [];
        const peopleByCompany = groupPeople(people);
        const opportunitiesByCompany = groupOpportunities(opportunities);
        const countIncludes = companyCountIncludes.filter((include) =>
            includeSet.has(include),
        );
        const counts =
            countIncludes.length === 0
                ? new Map<Ulid, CompanyRelationshipCounts>()
                : await this.repository.loadRelationshipCounts(
                      context.teamId,
                      companyIds,
                      countIncludes,
                  );
        const formattedCustomFields = await Promise.all(
            companies.map((company) =>
                this.customFields.format(context, "company", company.id),
            ),
        );

        return companies.map((company, index): CompanyView => ({
            record: company,
            customFields: formattedCustomFields[index] ?? {},
            ...(includeSet.has("creator")
                ? {
                      creator:
                          company.creatorId === null
                              ? null
                              : (usersById.get(company.creatorId) ?? null),
                  }
                : {}),
            ...(includeSet.has("accountOwner")
                ? {
                      accountOwner:
                          company.accountOwnerId === null
                              ? null
                              : (usersById.get(company.accountOwnerId) ?? null),
                  }
                : {}),
            ...(includeSet.has("people")
                ? { people: peopleByCompany.get(company.id) ?? [] }
                : {}),
            ...(includeSet.has("opportunities")
                ? {
                      opportunities:
                          opportunitiesByCompany.get(company.id) ?? [],
                  }
                : {}),
            counts: counts.get(company.id) ?? {},
        }));
    }

    private async loadPeople(
        context: RequestContext,
        companyIds: readonly Ulid[],
    ): Promise<readonly CompanyPersonView[]> {
        const people = await this.repository.loadPeople(
            context.teamId,
            companyIds,
        );

        return Promise.all(
            people.map(async (record: CompanyPersonRecord) => ({
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
        companyIds: readonly Ulid[],
    ): Promise<readonly CompanyOpportunityView[]> {
        const opportunities = await this.repository.loadOpportunities(
            context.teamId,
            companyIds,
        );

        return Promise.all(
            opportunities.map(async (record: CompanyOpportunityRecord) => ({
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
