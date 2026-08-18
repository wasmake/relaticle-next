import { describe, expect, it } from "vitest";

import { ApiBadRequestError } from "@/server/api/errors";
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
    handleOpportunitiesCollectionRequest,
    handleOpportunityRequest,
    type OpportunitiesApiDependencies,
} from "@/server/opportunities/handler";
import { parseOpportunityListQuery } from "@/server/opportunities/query";
import type {
    CreateOpportunityTransaction,
    OpportunitiesRepository,
    OpportunityForeignKey,
    OpportunityForeignKeys,
    UpdateOpportunityTransaction,
} from "@/server/opportunities/repository";
import {
    OpportunitiesService,
    type OpportunityCustomFieldsService,
} from "@/server/opportunities/service";
import type {
    OpportunityCompanyRecord,
    OpportunityContactRecord,
    OpportunityCountInclude,
    OpportunityListPage,
    OpportunityListQuery,
    OpportunityRecord,
    OpportunityRelationshipCounts,
    OpportunityUserRecord,
} from "@/server/opportunities/types";

const ulid = (sequence: number): Ulid =>
    ulidSchema.parse(`01J${sequence.toString().padStart(23, "0")}`);

const userId = ulid(1);
const teamId = ulid(2);
const otherTeamId = ulid(3);
const opportunityId = ulid(4);
const otherOpportunityId = ulid(5);
const companyId = ulid(6);
const contactId = ulid(7);
const customFieldId = ulid(8);
const customFieldValueId = ulid(9);
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

class InMemoryOpportunityCustomFields implements OpportunityCustomFieldsService {
    public readonly prepareCalls: CustomFieldWriteRequest[] = [];
    private readonly values = new Map<string, CustomFieldsApiObject>();

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
            (code) => code !== "stage",
        );

        if (unknown.length > 0) {
            throw new CustomFieldValidationError([
                {
                    path: "custom_fields",
                    message: `Unknown custom field keys: ${unknown.join(", ")}.`,
                },
            ]);
        }

        const key = `${request.entityType}:${request.entityId}`;
        const existing = this.values.get(key) ?? {};
        const next = Object.hasOwn(submitted, "stage")
            ? { ...existing, stage: submitted.stage as string | null }
            : existing;
        this.values.set(key, next);

        const mutations: readonly CustomFieldValueMutation[] = Object.hasOwn(
            submitted,
            "stage",
        )
            ? [
                  {
                      id: customFieldValueId,
                      teamId: context.teamId,
                      entityType: "opportunity",
                      entityId: request.entityId,
                      customFieldId,
                      ...emptyStorage(),
                      stringValue:
                          typeof submitted.stage === "string"
                              ? submitted.stage
                              : null,
                  },
              ]
            : [];

        return {
            teamId: context.teamId,
            entityType: request.entityType,
            entityId: request.entityId,
            mutations,
            optionPromotions: [],
        };
    }

    public async format(
        _context: Pick<RequestContext, "teamId">,
        entityType: "company" | "people" | "opportunity",
        entityId: Ulid,
    ): Promise<CustomFieldsApiObject> {
        return this.values.get(`${entityType}:${entityId}`) ?? {};
    }

    public seed(
        entityType: "company" | "people" | "opportunity",
        entityId: Ulid,
        fields: CustomFieldsApiObject,
    ): void {
        this.values.set(`${entityType}:${entityId}`, fields);
    }
}

const opportunity = (
    overrides: Partial<OpportunityRecord> = {},
): OpportunityRecord => ({
    id: opportunityId,
    teamId,
    creatorId: userId,
    companyId: null,
    contactId: null,
    name: "Enterprise Deal",
    creationSource: "api",
    createdAt: now,
    updatedAt: now,
    ...overrides,
});

class InMemoryOpportunitiesRepository implements OpportunitiesRepository {
    public readonly createInputs: CreateOpportunityTransaction[] = [];
    public readonly updateInputs: UpdateOpportunityTransaction[] = [];
    public readonly deleted: Ulid[] = [];
    public readonly records: OpportunityRecord[];
    public readonly companyIds = new Set<Ulid>();
    public readonly contactIds = new Set<Ulid>();
    public readonly lastActivities = new Map<Ulid, Date>();
    public readonly allowedCustomSorts = new Set(["stage"]);
    public users: OpportunityUserRecord[] = [
        { id: userId, name: "Ada Lovelace", email: "ada@example.test" },
    ];
    public companies: OpportunityCompanyRecord[] = [];
    public contacts: OpportunityContactRecord[] = [];
    public counts = new Map<Ulid, OpportunityRelationshipCounts>();

    public constructor(records: readonly OpportunityRecord[] = []) {
        this.records = [...records];
    }

    public async list(
        requestedTeamId: Ulid,
        query: OpportunityListQuery,
    ): Promise<OpportunityListPage> {
        for (const sort of query.sorts) {
            if (
                !["name", "created_at", "updated_at"].includes(sort.field) &&
                !this.allowedCustomSorts.has(sort.field)
            ) {
                throw new ApiBadRequestError(
                    `Requested sort ${sort.field} is not allowed.`,
                );
            }
        }

        for (const filter of query.filters.customFields) {
            if (filter.code !== "stage" || filter.operator !== "eq") {
                throw new ApiBadRequestError(
                    `Requested custom field filter ${filter.code}.${filter.operator} is not allowed.`,
                );
            }
        }

        let records = this.records.filter(
            (record) =>
                record.teamId === requestedTeamId &&
                !this.deleted.includes(record.id),
        );

        if (query.filters.name !== undefined) {
            const name = query.filters.name.toLocaleLowerCase();
            records = records.filter((record) =>
                record.name.toLocaleLowerCase().includes(name),
            );
        }

        if (query.filters.companyId !== undefined) {
            records = records.filter(
                (record) => record.companyId === query.filters.companyId,
            );
        }

        if (query.filters.contactId !== undefined) {
            records = records.filter(
                (record) => record.contactId === query.filters.contactId,
            );
        }

        if (query.filters.staleDays !== undefined) {
            const staleSince = new Date(
                now.getTime() - query.filters.staleDays * 24 * 60 * 60 * 1000,
            );
            records = records.filter((record) => {
                const lastActivity = this.lastActivities.get(record.id);

                return lastActivity === undefined || lastActivity < staleSince;
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
        requestedOpportunityId: Ulid,
    ): Promise<OpportunityRecord | undefined> {
        return this.records.find(
            (record) =>
                record.id === requestedOpportunityId &&
                record.teamId === requestedTeamId &&
                !this.deleted.includes(record.id),
        );
    }

    public async invalidForeignKeys(
        _requestedTeamId: Ulid,
        foreignKeys: OpportunityForeignKeys,
    ): Promise<readonly OpportunityForeignKey[]> {
        const invalid: OpportunityForeignKey[] = [];

        if (
            foreignKeys.companyId !== undefined &&
            foreignKeys.companyId !== null &&
            !this.companyIds.has(foreignKeys.companyId)
        ) {
            invalid.push("company_id");
        }

        if (
            foreignKeys.contactId !== undefined &&
            foreignKeys.contactId !== null &&
            !this.contactIds.has(foreignKeys.contactId)
        ) {
            invalid.push("contact_id");
        }

        return invalid;
    }

    public async create(
        input: CreateOpportunityTransaction,
    ): Promise<OpportunityRecord> {
        this.createInputs.push(input);
        const record = opportunity({
            id: input.id,
            teamId: input.teamId,
            creatorId: input.creatorId,
            companyId: input.companyId,
            contactId: input.contactId,
            name: input.name,
            creationSource: input.creationSource,
            createdAt: input.occurredAt,
            updatedAt: input.occurredAt,
        });
        this.records.push(record);

        return record;
    }

    public async update(
        input: UpdateOpportunityTransaction,
    ): Promise<OpportunityRecord | undefined> {
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

        const updated = {
            ...existing,
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.companyId === undefined
                ? {}
                : { companyId: input.companyId }),
            ...(input.contactId === undefined
                ? {}
                : { contactId: input.contactId }),
            updatedAt: input.occurredAt,
        };
        this.records[index] = updated;

        return updated;
    }

    public async softDelete(
        requestedTeamId: Ulid,
        requestedOpportunityId: Ulid,
    ): Promise<boolean> {
        const exists = await this.find(requestedTeamId, requestedOpportunityId);

        if (exists === undefined) {
            return false;
        }

        this.deleted.push(requestedOpportunityId);

        return true;
    }

    public async loadUsers(
        _requestedTeamId: Ulid,
        opportunities: readonly OpportunityRecord[],
    ): Promise<readonly OpportunityUserRecord[]> {
        const creatorIds = new Set(
            opportunities
                .map((record) => record.creatorId)
                .filter((id): id is Ulid => id !== null),
        );

        return this.users.filter((user) => creatorIds.has(user.id));
    }

    public async loadCompanies(
        requestedTeamId: Ulid,
        requestedCompanyIds: readonly Ulid[],
    ): Promise<readonly OpportunityCompanyRecord[]> {
        return this.companies.filter(
            (company) =>
                company.teamId === requestedTeamId &&
                requestedCompanyIds.includes(company.id),
        );
    }

    public async loadContacts(
        requestedTeamId: Ulid,
        requestedContactIds: readonly Ulid[],
    ): Promise<readonly OpportunityContactRecord[]> {
        return this.contacts.filter(
            (contact) =>
                contact.teamId === requestedTeamId &&
                requestedContactIds.includes(contact.id),
        );
    }

    public async loadRelationshipCounts(
        _requestedTeamId: Ulid,
        opportunityIds: readonly Ulid[],
        includes: readonly OpportunityCountInclude[],
    ): Promise<ReadonlyMap<Ulid, OpportunityRelationshipCounts>> {
        return new Map(
            opportunityIds.map((id) => {
                const configured = this.counts.get(id) ?? {};

                return [
                    id,
                    {
                        ...(includes.includes("tasksCount")
                            ? { tasksCount: configured.tasksCount ?? 0 }
                            : {}),
                        ...(includes.includes("notesCount")
                            ? { notesCount: configured.notesCount ?? 0 }
                            : {}),
                    },
                ];
            }),
        );
    }
}

const dependencies = (
    repository: InMemoryOpportunitiesRepository,
    customFields = new InMemoryOpportunityCustomFields(),
    authResult: HttpAuthResult = authenticated(),
): OpportunitiesApiDependencies => ({
    auth: new StaticAuthResolver(authResult),
    opportunities: new OpportunitiesService(
        repository,
        customFields,
        () => now,
        () => opportunityId,
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

describe("Opportunities write workflows", () => {
    it("composes tenant identity, related IDs, source, and custom fields into one create transaction", async () => {
        const repository = new InMemoryOpportunitiesRepository();
        repository.companyIds.add(companyId);
        repository.contactIds.add(contactId);
        const customFields = new InMemoryOpportunityCustomFields();
        const response = await handleOpportunitiesCollectionRequest(
            apiRequest("/api/v1/opportunities", "POST", {
                name: "  Enterprise Deal  ",
                company_id: companyId,
                contact_id: contactId,
                team_id: otherTeamId,
                creator_id: ulid(99),
                custom_fields: { stage: "  Proposal  " },
            }),
            dependencies(repository, customFields),
        );

        expect(response.status).toBe(201);
        expect(repository.createInputs).toHaveLength(1);
        expect(repository.createInputs[0]).toMatchObject({
            id: opportunityId,
            teamId,
            creatorId: userId,
            companyId,
            contactId,
            name: "Enterprise Deal",
            creationSource: "api",
            occurredAt: now,
            customFields: {
                teamId,
                entityType: "opportunity",
                entityId: opportunityId,
                mutations: [
                    expect.objectContaining({
                        teamId,
                        entityType: "opportunity",
                        entityId: opportunityId,
                        customFieldId,
                        stringValue: "Proposal",
                    }),
                ],
            },
        });
        await expect(response.json()).resolves.toEqual({
            data: {
                id: opportunityId,
                type: "opportunities",
                attributes: {
                    name: "Enterprise Deal",
                    company_id: companyId,
                    contact_id: contactId,
                    creation_source: "api",
                    created_at: "2026-08-18T12:00:00.000000Z",
                    updated_at: "2026-08-18T12:00:00.000000Z",
                    custom_fields: { stage: "Proposal" },
                },
            },
        });
    });

    it("rejects foreign company and contact IDs without writing", async () => {
        const repository = new InMemoryOpportunitiesRepository();
        const response = await handleOpportunitiesCollectionRequest(
            apiRequest("/api/v1/opportunities", "POST", {
                name: "Blocked Deal",
                company_id: companyId,
                contact_id: contactId,
            }),
            dependencies(repository),
        );

        expect(response.status).toBe(422);
        await expect(response.json()).resolves.toMatchObject({
            errors: {
                company_id: [expect.any(String)],
                contact_id: [expect.any(String)],
            },
        });
        expect(repository.createInputs).toEqual([]);
    });

    it("distinguishes omitted fields from submitted relationship and custom-field clears", async () => {
        const repository = new InMemoryOpportunitiesRepository([
            opportunity({ companyId, contactId }),
        ]);
        const customFields = new InMemoryOpportunityCustomFields();
        customFields.seed("opportunity", opportunityId, { stage: "Proposal" });
        const response = await handleOpportunityRequest(
            apiRequest(`/api/v1/opportunities/${opportunityId}`, "PATCH", {
                company_id: null,
                contact_id: null,
                custom_fields: { stage: null },
            }),
            opportunityId,
            dependencies(repository, customFields),
        );

        expect(response.status).toBe(200);
        expect(repository.updateInputs[0]).toMatchObject({
            companyId: null,
            contactId: null,
            customFields: {
                mutations: [expect.objectContaining({ stringValue: null })],
            },
        });
        expect(repository.updateInputs[0]).not.toHaveProperty("name");
        expect(repository.records[0]).toMatchObject({
            name: "Enterprise Deal",
            companyId: null,
            contactId: null,
        });
        expect(
            (
                (await response.json()) as {
                    data: { attributes: { custom_fields: unknown } };
                }
            ).data.attributes.custom_fields,
        ).toEqual({ stage: null });
    });

    it("soft deletes an opportunity and hides it from subsequent reads", async () => {
        const repository = new InMemoryOpportunitiesRepository([opportunity()]);
        const api = dependencies(repository);
        const deleted = await handleOpportunityRequest(
            apiRequest(`/api/v1/opportunities/${opportunityId}`, "DELETE"),
            opportunityId,
            api,
        );
        const shown = await handleOpportunityRequest(
            apiRequest(`/api/v1/opportunities/${opportunityId}`),
            opportunityId,
            api,
        );

        expect(deleted.status).toBe(204);
        expect(await deleted.text()).toBe("");
        expect(repository.deleted).toEqual([opportunityId]);
        expect(shown.status).toBe(404);
    });
});

describe("Opportunities isolation, authorization, and resources", () => {
    it("returns the same 404 for foreign, missing, soft-deleted, and malformed IDs", async () => {
        const repository = new InMemoryOpportunitiesRepository([
            opportunity({ id: otherOpportunityId, teamId: otherTeamId }),
            opportunity(),
        ]);
        repository.deleted.push(opportunityId);
        const api = dependencies(repository);
        const foreign = await handleOpportunityRequest(
            apiRequest(`/api/v1/opportunities/${otherOpportunityId}`),
            otherOpportunityId,
            api,
        );
        const missingId = ulid(77);
        const missing = await handleOpportunityRequest(
            apiRequest(`/api/v1/opportunities/${missingId}`),
            missingId,
            api,
        );
        const deleted = await handleOpportunityRequest(
            apiRequest(`/api/v1/opportunities/${opportunityId}`),
            opportunityId,
            api,
        );
        const invalidBodyAgainstForeign = await handleOpportunityRequest(
            apiRequest(`/api/v1/opportunities/${otherOpportunityId}`, "PATCH", {
                name: null,
            }),
            otherOpportunityId,
            api,
        );
        const malformed = await handleOpportunityRequest(
            apiRequest("/api/v1/opportunities/not-a-ulid"),
            "not-a-ulid",
            api,
        );

        expect([
            foreign.status,
            missing.status,
            deleted.status,
            invalidBodyAgainstForeign.status,
            malformed.status,
        ]).toEqual([404, 404, 404, 404, 404]);
        expect(await foreign.text()).toBe(await missing.text());
    });

    it("enforces API abilities before invoking the create workflow", async () => {
        const repository = new InMemoryOpportunitiesRepository();
        const response = await handleOpportunitiesCollectionRequest(
            apiRequest("/api/v1/opportunities", "POST", { name: "Blocked" }),
            dependencies(
                repository,
                new InMemoryOpportunityCustomFields(),
                authenticated(requestContext(["read"])),
            ),
        );

        expect(response.status).toBe(403);
        expect(repository.createInputs).toEqual([]);
    });

    it("keeps default resources sparse and renders only requested relationships and counts", async () => {
        const repository = new InMemoryOpportunitiesRepository([
            opportunity({ companyId, contactId }),
        ]);
        repository.companies = [
            {
                id: companyId,
                teamId,
                name: "Acme Corp",
                creationSource: "api",
                createdAt: now,
                updatedAt: now,
            },
        ];
        repository.contacts = [
            {
                id: contactId,
                teamId,
                companyId,
                name: "Grace Hopper",
                creationSource: "api",
                createdAt: now,
                updatedAt: now,
            },
        ];
        repository.counts.set(opportunityId, { tasksCount: 2, notesCount: 3 });
        const customFields = new InMemoryOpportunityCustomFields();
        customFields.seed("company", companyId, { industry: "Technology" });
        customFields.seed("people", contactId, { role: "Champion" });
        const api = dependencies(repository, customFields);
        const sparse = await handleOpportunityRequest(
            apiRequest(`/api/v1/opportunities/${opportunityId}`),
            opportunityId,
            api,
        );
        const included = await handleOpportunityRequest(
            apiRequest(
                `/api/v1/opportunities/${opportunityId}?include=creator,company,contact,tasksCount,notesCount`,
            ),
            opportunityId,
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
            tasks_count: 2,
            notes_count: 3,
        });
        expect(includedDocument.data.relationships).toEqual({
            creator: { data: { id: userId, type: "users" } },
            company: { data: { id: companyId, type: "companies" } },
            contact: { data: { id: contactId, type: "people" } },
        });
        expect(includedDocument.included).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: userId, type: "users" }),
                expect.objectContaining({ id: companyId, type: "companies" }),
                expect.objectContaining({ id: contactId, type: "people" }),
            ]),
        );
    });
});

describe("Opportunities list workflows", () => {
    it("parses pagination, all native filters, stale days, custom fields, sorts, and includes", () => {
        expect(
            parseOpportunityListQuery(
                new URL(
                    `https://crm.example.test/api/v1/opportunities?per_page=25&page=2&filter[name]=Enterprise&filter[company_id]=${companyId}&filter[contact_id]=${contactId}&filter[created_after]=2026-01-01&filter[created_before]=2026-08-18&filter[stale_days]=30&filter[custom_fields][stage][eq]=Proposal&sort=name,-stage&include=creator,company,tasksCount`,
                ),
            ),
        ).toEqual({
            page: 2,
            perPage: 25,
            filters: {
                name: "Enterprise",
                companyId,
                contactId,
                createdAfter: "2026-01-01",
                createdBefore: "2026-08-18",
                staleDays: 30,
                customFields: [
                    { code: "stage", operator: "eq", value: "Proposal" },
                ],
            },
            sorts: [
                { field: "name", direction: "asc" },
                { field: "stage", direction: "desc" },
            ],
            includes: ["creator", "company", "tasksCount"],
        });
    });

    it.each([
        "filter[team_id]=secret",
        "filter[stale_days]=never",
        "filter[custom_fields][stage][contains]=Pro",
        "sort=team_id",
        "include=secret",
        "cursor=true",
    ])("rejects unsupported query semantics: %s", async (query) => {
        const response = await handleOpportunitiesCollectionRequest(
            apiRequest(`/api/v1/opportunities?${query}`),
            dependencies(new InMemoryOpportunitiesRepository()),
        );

        expect(response.status).toBe(400);
    });

    it("applies tenant scope, stale-days activity scope, and page pagination", async () => {
        const staleId = ulid(20);
        const activeId = ulid(21);
        const secondStaleId = ulid(22);
        const repository = new InMemoryOpportunitiesRepository([
            opportunity({ id: staleId, name: "Stale One" }),
            opportunity({ id: activeId, name: "Active" }),
            opportunity({ id: secondStaleId, name: "Stale Two" }),
            opportunity({ id: otherOpportunityId, teamId: otherTeamId }),
        ]);
        repository.lastActivities.set(
            staleId,
            new Date("2026-06-01T00:00:00.000Z"),
        );
        repository.lastActivities.set(
            activeId,
            new Date("2026-08-17T00:00:00.000Z"),
        );
        const response = await handleOpportunitiesCollectionRequest(
            apiRequest(
                "/api/v1/opportunities?filter[stale_days]=30&per_page=1&page=2",
            ),
            dependencies(repository),
        );
        const document = (await response.json()) as {
            data: readonly { id: string }[];
            meta: Record<string, unknown>;
        };

        expect(response.status).toBe(200);
        expect(document.data).toHaveLength(1);
        expect(document.data[0]?.id).toBe(secondStaleId);
        expect(document.meta).toMatchObject({
            current_page: 2,
            per_page: 1,
            total: 2,
            from: 2,
            to: 2,
        });
    });

    it("returns Laravel-style pagination and payload validation errors", async () => {
        const api = dependencies(new InMemoryOpportunitiesRepository());
        const pagination = await handleOpportunitiesCollectionRequest(
            apiRequest("/api/v1/opportunities?per_page=101"),
            api,
        );
        const missingName = await handleOpportunitiesCollectionRequest(
            apiRequest("/api/v1/opportunities", "POST", {}),
            api,
        );
        const malformedRelatedId = await handleOpportunitiesCollectionRequest(
            apiRequest("/api/v1/opportunities", "POST", {
                name: "Deal",
                company_id: "not-a-ulid",
            }),
            api,
        );
        const customField = await handleOpportunitiesCollectionRequest(
            apiRequest("/api/v1/opportunities", "POST", {
                name: "Deal",
                custom_fields: { guessed_secret: "value" },
            }),
            api,
        );

        expect(pagination.status).toBe(422);
        await expect(pagination.json()).resolves.toMatchObject({
            errors: { per_page: [expect.stringContaining("100")] },
        });
        expect(missingName.status).toBe(422);
        await expect(missingName.json()).resolves.toMatchObject({
            errors: { name: [expect.any(String)] },
        });
        expect(malformedRelatedId.status).toBe(422);
        await expect(malformedRelatedId.json()).resolves.toMatchObject({
            errors: { company_id: [expect.any(String)] },
        });
        expect(customField.status).toBe(422);
        await expect(customField.json()).resolves.toMatchObject({
            errors: { custom_fields: [expect.any(String)] },
        });
    });
});
