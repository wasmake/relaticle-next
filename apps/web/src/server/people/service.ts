import { ApiNotFoundError, ApiValidationError } from "@/server/api/errors";
import type { RequestContext } from "@/server/context/request-context";
import type {
    CustomFieldsApiObject,
    CustomFieldWriteRequest,
    PreparedCustomFieldWrite,
} from "@/server/custom-fields/types";
import { createUlid, type Ulid } from "@/server/ids";

import type { PeopleRepository } from "./repository";
import type {
    PeopleCompanyRecord,
    PeopleCompanyView,
    PeopleInclude,
    PeopleListQuery,
    PeopleListView,
    PeopleRecord,
    PeopleRelationshipCounts,
    PeopleSparseField,
    PeopleUserRecord,
    PeopleView,
} from "./types";
import { peopleCountIncludes } from "./types";
import { validateCreatePeople, validateUpdatePeople } from "./validation";

export interface PeopleCustomFieldsService {
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
    personId: Ulid,
    prepared: PreparedCustomFieldWrite,
): void => {
    const invalidMutation = prepared.mutations.some(
        (mutation) =>
            mutation.teamId !== context.teamId ||
            mutation.entityType !== "people" ||
            mutation.entityId !== personId,
    );
    const invalidPromotion = prepared.optionPromotions.some(
        (promotion) => promotion.teamId !== context.teamId,
    );

    if (
        prepared.teamId !== context.teamId ||
        prepared.entityType !== "people" ||
        prepared.entityId !== personId ||
        invalidMutation ||
        invalidPromotion
    ) {
        throw new Error(
            "Prepared custom fields do not match the people transaction.",
        );
    }
};

export class PeopleService {
    public constructor(
        private readonly repository: PeopleRepository,
        private readonly customFields: PeopleCustomFieldsService,
        private readonly now: () => Date = () => new Date(),
        private readonly createId: () => Ulid = createUlid,
    ) {}

    public async list(
        context: RequestContext,
        query: PeopleListQuery,
    ): Promise<PeopleListView> {
        const page = await this.repository.list(context.teamId, query);
        const people = await this.loadViews(
            context,
            page.records,
            query.includes,
            query.fields,
        );

        if (page.kind === "cursor") {
            return {
                kind: "cursor",
                people,
                perPage: query.perPage,
                nextCursor: page.nextCursor,
                previousCursor: page.previousCursor,
            };
        }

        const pageNumber =
            query.pagination.kind === "page" ? query.pagination.page : 1;

        return {
            kind: "page",
            people,
            page: pageNumber,
            perPage: query.perPage,
            total: page.total,
        };
    }

    public async show(
        context: RequestContext,
        personId: Ulid,
        includes: readonly PeopleInclude[],
        fields?: readonly PeopleSparseField[],
    ): Promise<PeopleView> {
        const person = await this.repository.find(context.teamId, personId);

        if (person === undefined) {
            throw new ApiNotFoundError();
        }

        const [view] = await this.loadViews(
            context,
            [person],
            includes,
            fields,
        );

        if (view === undefined) {
            throw new ApiNotFoundError();
        }

        return view;
    }

    public async create(
        context: RequestContext,
        body: Readonly<Record<string, unknown>>,
        includes: readonly PeopleInclude[],
        fields?: readonly PeopleSparseField[],
        creationSource: "api" | "chat" = "api",
    ): Promise<PeopleView> {
        const data = validateCreatePeople(body);
        await this.assertCompanyOwned(context.teamId, data.companyId);

        const id = this.createId();
        const customFields = await this.customFields.prepareWrite(context, {
            entityType: "people",
            entityId: id,
            operation: "create",
            ...(Object.hasOwn(data, "customFields")
                ? { customFields: data.customFields }
                : {}),
        });
        assertPreparedWrite(context, id, customFields);

        const person = await this.repository.create({
            id,
            teamId: context.teamId,
            creatorId: context.userId,
            companyId: data.companyId,
            name: data.name,
            creationSource,
            occurredAt: this.now(),
            customFields,
        });
        const [view] = await this.loadViews(
            context,
            [person],
            includes,
            fields,
        );

        if (view === undefined) {
            throw new Error("The created person could not be loaded.");
        }

        return view;
    }

    public async update(
        context: RequestContext,
        personId: Ulid,
        body: Readonly<Record<string, unknown>>,
        includes: readonly PeopleInclude[],
        fields?: readonly PeopleSparseField[],
    ): Promise<PeopleView> {
        const existing = await this.repository.find(context.teamId, personId);

        if (existing === undefined) {
            throw new ApiNotFoundError();
        }

        const data = validateUpdatePeople(body);

        if (Object.hasOwn(data, "companyId")) {
            await this.assertCompanyOwned(
                context.teamId,
                data.companyId ?? null,
            );
        }

        const hasCustomFields = Object.hasOwn(data, "customFields");
        const customFields = hasCustomFields
            ? await this.customFields.prepareWrite(context, {
                  entityType: "people",
                  entityId: personId,
                  operation: "update",
                  customFields: data.customFields,
              })
            : undefined;

        if (customFields !== undefined) {
            assertPreparedWrite(context, personId, customFields);
        }

        let person = existing;

        if (
            data.name !== undefined ||
            Object.hasOwn(data, "companyId") ||
            customFields !== undefined
        ) {
            const updated = await this.repository.update(
                {
                    id: personId,
                    teamId: context.teamId,
                    occurredAt: this.now(),
                    ...(data.name === undefined ? {} : { name: data.name }),
                    ...(Object.hasOwn(data, "companyId")
                        ? { companyId: data.companyId ?? null }
                        : {}),
                    ...(customFields === undefined ? {} : { customFields }),
                },
                context.userId,
            );

            if (updated === undefined) {
                throw new ApiNotFoundError();
            }

            person = updated;
        }

        const [view] = await this.loadViews(
            context,
            [person],
            includes,
            fields,
        );

        if (view === undefined) {
            throw new ApiNotFoundError();
        }

        return view;
    }

    public async delete(
        context: RequestContext,
        personId: Ulid,
    ): Promise<void> {
        const existing = await this.repository.find(context.teamId, personId);

        if (existing === undefined) {
            throw new ApiNotFoundError();
        }

        const deleted = await this.repository.softDelete(
            context.teamId,
            personId,
            this.now(),
            context.userId,
        );

        if (!deleted) {
            throw new ApiNotFoundError();
        }
    }

    private async assertCompanyOwned(
        teamId: Ulid,
        companyId: Ulid | null,
    ): Promise<void> {
        if (
            companyId !== null &&
            !(await this.repository.companyExists(teamId, companyId))
        ) {
            throw new ApiValidationError([
                {
                    path: "company_id",
                    message: "The selected company id is invalid.",
                },
            ]);
        }
    }

    private async loadViews(
        context: RequestContext,
        records: readonly PeopleRecord[],
        includes: readonly PeopleInclude[],
        fields?: readonly PeopleSparseField[],
    ): Promise<readonly PeopleView[]> {
        if (records.length === 0) {
            return [];
        }

        const includeSet = new Set(includes);
        const personIds = records.map((person) => person.id);
        const users = includeSet.has("creator")
            ? await this.repository.loadUsers(context.teamId, records)
            : [];
        const usersById = new Map<Ulid, PeopleUserRecord>(
            users.map((user) => [user.id, user]),
        );
        const companyIds = [
            ...new Set(
                records
                    .map((person) => person.companyId)
                    .filter((id): id is Ulid => id !== null),
            ),
        ];
        const companies = includeSet.has("company")
            ? await this.loadCompanies(context, companyIds)
            : [];
        const companiesById = new Map<Ulid, PeopleCompanyView>(
            companies.map((company) => [company.record.id, company]),
        );
        const countIncludes = peopleCountIncludes.filter((include) =>
            includeSet.has(include),
        );
        const counts =
            countIncludes.length === 0
                ? new Map<Ulid, PeopleRelationshipCounts>()
                : await this.repository.loadRelationshipCounts(
                      context.teamId,
                      personIds,
                      countIncludes,
                  );
        const formattedCustomFields = await Promise.all(
            records.map((person) =>
                this.customFields.format(context, "people", person.id),
            ),
        );

        return records.map((person, index): PeopleView => ({
            record: person,
            customFields: formattedCustomFields[index] ?? {},
            ...(includeSet.has("creator")
                ? {
                      creator:
                          person.creatorId === null
                              ? null
                              : (usersById.get(person.creatorId) ?? null),
                  }
                : {}),
            ...(includeSet.has("company")
                ? {
                      company:
                          person.companyId === null
                              ? null
                              : (companiesById.get(person.companyId) ?? null),
                  }
                : {}),
            counts: counts.get(person.id) ?? {},
            ...(fields === undefined ? {} : { fields }),
        }));
    }

    private async loadCompanies(
        context: RequestContext,
        companyIds: readonly Ulid[],
    ): Promise<readonly PeopleCompanyView[]> {
        const companies = await this.repository.loadCompanies(
            context.teamId,
            companyIds,
        );

        return Promise.all(
            companies.map(async (record: PeopleCompanyRecord) => ({
                record,
                customFields: await this.customFields.format(
                    context,
                    "company",
                    record.id,
                ),
            })),
        );
    }
}
