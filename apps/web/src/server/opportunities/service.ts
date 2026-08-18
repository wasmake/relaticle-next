import { ApiNotFoundError, ApiValidationError } from "@/server/api/errors";
import type { RequestContext } from "@/server/context/request-context";
import type {
    CustomFieldsApiObject,
    CustomFieldWriteRequest,
    PreparedCustomFieldWrite,
} from "@/server/custom-fields/types";
import { createUlid, type Ulid } from "@/server/ids";

import type { OpportunitiesRepository } from "./repository";
import type {
    OpportunityCompanyRecord,
    OpportunityCompanyView,
    OpportunityContactRecord,
    OpportunityContactView,
    OpportunityInclude,
    OpportunityListQuery,
    OpportunityListView,
    OpportunityRecord,
    OpportunityRelationshipCounts,
    OpportunityUserRecord,
    OpportunityView,
} from "./types";
import { opportunityCountIncludes } from "./types";
import {
    validateCreateOpportunity,
    validateUpdateOpportunity,
} from "./validation";

export interface OpportunityCustomFieldsService {
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

const assertPreparedWrite = (
    context: RequestContext,
    opportunityId: Ulid,
    prepared: PreparedCustomFieldWrite,
): void => {
    const invalidMutation = prepared.mutations.some(
        (mutation) =>
            mutation.teamId !== context.teamId ||
            mutation.entityType !== "opportunity" ||
            mutation.entityId !== opportunityId,
    );
    const invalidPromotion = prepared.optionPromotions.some(
        (promotion) => promotion.teamId !== context.teamId,
    );

    if (
        prepared.teamId !== context.teamId ||
        prepared.entityType !== "opportunity" ||
        prepared.entityId !== opportunityId ||
        invalidMutation ||
        invalidPromotion
    ) {
        throw new Error(
            "Prepared custom fields do not match the opportunity transaction.",
        );
    }
};

export class OpportunitiesService {
    public constructor(
        private readonly repository: OpportunitiesRepository,
        private readonly customFields: OpportunityCustomFieldsService,
        private readonly now: () => Date = () => new Date(),
        private readonly createId: () => Ulid = createUlid,
    ) {}

    public async list(
        context: RequestContext,
        query: OpportunityListQuery,
    ): Promise<OpportunityListView> {
        const page = await this.repository.list(context.teamId, query);

        return {
            opportunities: await this.loadViews(
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
        opportunityId: Ulid,
        includes: readonly OpportunityInclude[],
    ): Promise<OpportunityView> {
        const opportunity = await this.repository.find(
            context.teamId,
            opportunityId,
        );

        if (opportunity === undefined) {
            throw new ApiNotFoundError();
        }

        const [view] = await this.loadViews(context, [opportunity], includes);

        if (view === undefined) {
            throw new ApiNotFoundError();
        }

        return view;
    }

    public async create(
        context: RequestContext,
        body: Readonly<Record<string, unknown>>,
        includes: readonly OpportunityInclude[],
    ): Promise<OpportunityView> {
        const data = validateCreateOpportunity(body);
        await this.assertForeignKeys(context, data);

        const id = this.createId();
        const customFields = await this.customFields.prepareWrite(context, {
            entityType: "opportunity",
            entityId: id,
            operation: "create",
            ...(Object.hasOwn(data, "customFields")
                ? { customFields: data.customFields }
                : {}),
        });
        assertPreparedWrite(context, id, customFields);

        const opportunity = await this.repository.create({
            id,
            teamId: context.teamId,
            creatorId: context.userId,
            companyId: data.companyId ?? null,
            contactId: data.contactId ?? null,
            name: data.name,
            creationSource: "api",
            occurredAt: this.now(),
            customFields,
        });
        const [view] = await this.loadViews(context, [opportunity], includes);

        if (view === undefined) {
            throw new Error("The created opportunity could not be loaded.");
        }

        return view;
    }

    public async update(
        context: RequestContext,
        opportunityId: Ulid,
        body: Readonly<Record<string, unknown>>,
        includes: readonly OpportunityInclude[],
    ): Promise<OpportunityView> {
        const existing = await this.repository.find(
            context.teamId,
            opportunityId,
        );

        if (existing === undefined) {
            throw new ApiNotFoundError();
        }

        const data = validateUpdateOpportunity(body);
        await this.assertForeignKeys(context, data);

        const hasCustomFields = Object.hasOwn(data, "customFields");
        const customFields = hasCustomFields
            ? await this.customFields.prepareWrite(context, {
                  entityType: "opportunity",
                  entityId: opportunityId,
                  operation: "update",
                  customFields: data.customFields,
              })
            : undefined;

        if (customFields !== undefined) {
            assertPreparedWrite(context, opportunityId, customFields);
        }

        let opportunity = existing;

        if (
            data.name !== undefined ||
            Object.hasOwn(data, "companyId") ||
            Object.hasOwn(data, "contactId") ||
            customFields !== undefined
        ) {
            const updated = await this.repository.update(
                {
                    id: opportunityId,
                    teamId: context.teamId,
                    occurredAt: this.now(),
                    ...(data.name === undefined ? {} : { name: data.name }),
                    ...(Object.hasOwn(data, "companyId")
                        ? { companyId: data.companyId }
                        : {}),
                    ...(Object.hasOwn(data, "contactId")
                        ? { contactId: data.contactId }
                        : {}),
                    ...(customFields === undefined ? {} : { customFields }),
                },
                context.userId,
            );

            if (updated === undefined) {
                throw new ApiNotFoundError();
            }

            opportunity = updated;
        }

        const [view] = await this.loadViews(context, [opportunity], includes);

        if (view === undefined) {
            throw new ApiNotFoundError();
        }

        return view;
    }

    public async delete(
        context: RequestContext,
        opportunityId: Ulid,
    ): Promise<void> {
        const existing = await this.repository.find(
            context.teamId,
            opportunityId,
        );

        if (existing === undefined) {
            throw new ApiNotFoundError();
        }

        const deleted = await this.repository.softDelete(
            context.teamId,
            opportunityId,
            this.now(),
            context.userId,
        );

        if (!deleted) {
            throw new ApiNotFoundError();
        }
    }

    private async assertForeignKeys(
        context: RequestContext,
        data: Readonly<{
            companyId?: Ulid | null;
            contactId?: Ulid | null;
        }>,
    ): Promise<void> {
        const invalid = await this.repository.invalidForeignKeys(
            context.teamId,
            data,
        );

        if (invalid.length > 0) {
            throw new ApiValidationError(
                invalid.map((path) => ({
                    path,
                    message: `The selected ${path.replace("_", " ")} is invalid.`,
                })),
            );
        }
    }

    private async loadViews(
        context: RequestContext,
        opportunities: readonly OpportunityRecord[],
        includes: readonly OpportunityInclude[],
    ): Promise<readonly OpportunityView[]> {
        if (opportunities.length === 0) {
            return [];
        }

        const includeSet = new Set(includes);
        const opportunityIds = opportunities.map(
            (opportunity) => opportunity.id,
        );
        const companyIds = opportunities
            .map((opportunity) => opportunity.companyId)
            .filter((id): id is Ulid => id !== null);
        const contactIds = opportunities
            .map((opportunity) => opportunity.contactId)
            .filter((id): id is Ulid => id !== null);
        const countIncludes = opportunityCountIncludes.filter((include) =>
            includeSet.has(include),
        );
        const [users, companies, contacts, counts, formattedCustomFields] =
            await Promise.all([
                includeSet.has("creator")
                    ? this.repository.loadUsers(context.teamId, opportunities)
                    : [],
                includeSet.has("company")
                    ? this.repository.loadCompanies(context.teamId, companyIds)
                    : [],
                includeSet.has("contact")
                    ? this.repository.loadContacts(context.teamId, contactIds)
                    : [],
                countIncludes.length === 0
                    ? new Map<Ulid, OpportunityRelationshipCounts>()
                    : this.repository.loadRelationshipCounts(
                          context.teamId,
                          opportunityIds,
                          countIncludes,
                      ),
                Promise.all(
                    opportunities.map((opportunity) =>
                        this.customFields.format(
                            context,
                            "opportunity",
                            opportunity.id,
                        ),
                    ),
                ),
            ]);
        const usersById = new Map<Ulid, OpportunityUserRecord>(
            users.map((user) => [user.id, user]),
        );
        const companyViews = await this.loadCompanyViews(context, companies);
        const companiesById = new Map<Ulid, OpportunityCompanyView>(
            companyViews.map((company) => [company.record.id, company]),
        );
        const contactViews = await this.loadContactViews(context, contacts);
        const contactsById = new Map<Ulid, OpportunityContactView>(
            contactViews.map((contact) => [contact.record.id, contact]),
        );

        return opportunities.map((opportunity, index): OpportunityView => ({
            record: opportunity,
            customFields: formattedCustomFields[index] ?? {},
            ...(includeSet.has("creator")
                ? {
                      creator:
                          opportunity.creatorId === null
                              ? null
                              : (usersById.get(opportunity.creatorId) ?? null),
                  }
                : {}),
            ...(includeSet.has("company")
                ? {
                      company:
                          opportunity.companyId === null
                              ? null
                              : (companiesById.get(opportunity.companyId) ??
                                null),
                  }
                : {}),
            ...(includeSet.has("contact")
                ? {
                      contact:
                          opportunity.contactId === null
                              ? null
                              : (contactsById.get(opportunity.contactId) ??
                                null),
                  }
                : {}),
            counts: counts.get(opportunity.id) ?? {},
        }));
    }

    private async loadCompanyViews(
        context: RequestContext,
        companies: readonly OpportunityCompanyRecord[],
    ): Promise<readonly OpportunityCompanyView[]> {
        return Promise.all(
            companies.map(async (record) => ({
                record,
                customFields: await this.customFields.format(
                    context,
                    "company",
                    record.id,
                ),
            })),
        );
    }

    private async loadContactViews(
        context: RequestContext,
        contacts: readonly OpportunityContactRecord[],
    ): Promise<readonly OpportunityContactView[]> {
        return Promise.all(
            contacts.map(async (record) => ({
                record,
                customFields: await this.customFields.format(
                    context,
                    "people",
                    record.id,
                ),
            })),
        );
    }
}
