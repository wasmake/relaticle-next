import { describe, expect, it } from "vitest";

import type { ApiAccessResult } from "@/server/api/access";
import {
    apiAccessFromHttpAuthResult,
    type ApiAccessResolver,
} from "@/server/api/http";
import type { HttpAuthResult } from "@/server/auth/http";
import { createRequestContext, type RequestContext } from "@/server/context/request-context";
import type {
    CustomFieldsApiObject,
    CustomFieldStorageValues,
    CustomFieldValueMutation,
    CustomFieldWriteRequest,
    PreparedCustomFieldWrite,
} from "@/server/custom-fields/types";
import { CustomFieldValidationError } from "@/server/custom-fields/types";
import type { Ulid } from "@/server/ids";
import { ulidSchema } from "@/server/ids";
import { handleUserRequest } from "@/server/api/user";
import {
    handleCompaniesCollectionRequest,
    handleCompanyRequest,
    type CompaniesApiDependencies,
} from "@/server/companies/handler";
import { parseCompanyListQuery } from "@/server/companies/query";
import type {
    CompaniesRepository,
    CreateCompanyTransaction,
    UpdateCompanyTransaction,
} from "@/server/companies/repository";
import {
    CompaniesService,
    type CompanyCustomFieldsService,
} from "@/server/companies/service";
import type {
    CompanyCountInclude,
    CompanyListPage,
    CompanyListQuery,
    CompanyOpportunityRecord,
    CompanyPersonRecord,
    CompanyRecord,
    CompanyRelationshipCounts,
    CompanyUserRecord,
} from "@/server/companies/types";

const ulid = (sequence: number): Ulid =>
    ulidSchema.parse(`01J${sequence.toString().padStart(23, "0")}`);

const userId = ulid(1);
const teamId = ulid(2);
const otherTeamId = ulid(3);
const companyId = ulid(4);
const otherCompanyId = ulid(5);
const customFieldId = ulid(6);
const customFieldValueId = ulid(7);
const personId = ulid(8);
const now = new Date("2026-08-18T12:00:00.000Z");

const requestContext = (
    abilities: readonly ("read" | "create" | "update" | "delete")[] | null = null,
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

const authenticated = (context: RequestContext = requestContext()): HttpAuthResult => ({
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

class InMemoryCompanyCustomFields implements CompanyCustomFieldsService {
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
            (code) => code !== "industry",
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
        const next = Object.hasOwn(submitted, "industry")
            ? { ...existing, industry: submitted.industry as string | null }
            : existing;
        this.values.set(request.entityId, next);

        const mutations: readonly CustomFieldValueMutation[] = Object.hasOwn(
            submitted,
            "industry",
        )
            ? [
                  {
                      id: customFieldValueId,
                      teamId: context.teamId,
                      entityType: "company",
                      entityId: request.entityId,
                      customFieldId,
                      ...emptyStorage(),
                      textValue:
                          typeof submitted.industry === "string"
                              ? submitted.industry
                              : null,
                  },
              ]
            : [];

        return {
            teamId: context.teamId,
            entityType: "company",
            entityId: request.entityId,
            mutations,
            optionPromotions: [],
        };
    }

    public async format(
        _context: Pick<RequestContext, "teamId">,
        _entityType: "company" | "people" | "opportunity",
        entityId: Ulid,
    ): Promise<CustomFieldsApiObject> {
        return this.values.get(entityId) ?? {};
    }

    public seed(entityId: Ulid, fields: CustomFieldsApiObject): void {
        this.values.set(entityId, fields);
    }
}

const company = (
    overrides: Partial<CompanyRecord> = {},
): CompanyRecord => ({
    id: companyId,
    teamId,
    creatorId: userId,
    accountOwnerId: null,
    name: "Acme Corp",
    creationSource: "api",
    createdAt: now,
    updatedAt: now,
    ...overrides,
});

class InMemoryCompaniesRepository implements CompaniesRepository {
    public readonly createInputs: CreateCompanyTransaction[] = [];
    public readonly updateInputs: UpdateCompanyTransaction[] = [];
    public readonly deleted: Ulid[] = [];
    public readonly records: CompanyRecord[];
    public users: CompanyUserRecord[] = [
        { id: userId, name: "Ada Lovelace", email: "ada@example.test" },
    ];
    public people: CompanyPersonRecord[] = [];
    public opportunities: CompanyOpportunityRecord[] = [];
    public counts = new Map<Ulid, CompanyRelationshipCounts>();

    public constructor(records: readonly CompanyRecord[] = []) {
        this.records = [...records];
    }

    public async list(
        requestedTeamId: Ulid,
        query: CompanyListQuery,
    ): Promise<CompanyListPage> {
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

        const total = records.length;
        const start = (query.page - 1) * query.perPage;

        return {
            records: records.slice(start, start + query.perPage),
            total,
        };
    }

    public async find(
        requestedTeamId: Ulid,
        requestedCompanyId: Ulid,
    ): Promise<CompanyRecord | undefined> {
        return this.records.find(
            (record) =>
                record.id === requestedCompanyId &&
                record.teamId === requestedTeamId &&
                !this.deleted.includes(record.id),
        );
    }

    public async create(input: CreateCompanyTransaction): Promise<CompanyRecord> {
        this.createInputs.push(input);
        const record = company({
            id: input.id,
            teamId: input.teamId,
            creatorId: input.creatorId,
            name: input.name,
            creationSource: input.creationSource,
            createdAt: input.occurredAt,
            updatedAt: input.occurredAt,
        });
        this.records.push(record);

        return record;
    }

    public async update(
        input: UpdateCompanyTransaction,
    ): Promise<CompanyRecord | undefined> {
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
            updatedAt: input.occurredAt,
        };
        this.records[index] = updated;

        return updated;
    }

    public async softDelete(
        requestedTeamId: Ulid,
        requestedCompanyId: Ulid,
    ): Promise<boolean> {
        const exists = await this.find(requestedTeamId, requestedCompanyId);

        if (exists === undefined) {
            return false;
        }

        this.deleted.push(requestedCompanyId);

        return true;
    }

    public async loadUsers(
        requestedTeamId: Ulid,
        companies: readonly CompanyRecord[],
    ): Promise<readonly CompanyUserRecord[]> {
        const userIds = new Set(
            companies
                .filter((record) => record.teamId === requestedTeamId)
                .flatMap((record) => [record.creatorId, record.accountOwnerId])
                .filter((id): id is Ulid => id !== null),
        );

        return this.users.filter((user) => userIds.has(user.id));
    }

    public async loadPeople(
        requestedTeamId: Ulid,
        companyIds: readonly Ulid[],
    ): Promise<readonly CompanyPersonRecord[]> {
        return this.people.filter(
            (person) =>
                person.teamId === requestedTeamId &&
                companyIds.includes(person.companyId),
        );
    }

    public async loadOpportunities(
        requestedTeamId: Ulid,
        companyIds: readonly Ulid[],
    ): Promise<readonly CompanyOpportunityRecord[]> {
        return this.opportunities.filter(
            (opportunity) =>
                opportunity.teamId === requestedTeamId &&
                companyIds.includes(opportunity.companyId),
        );
    }

    public async loadRelationshipCounts(
        _requestedTeamId: Ulid,
        companyIds: readonly Ulid[],
        includes: readonly CompanyCountInclude[],
    ): Promise<ReadonlyMap<Ulid, CompanyRelationshipCounts>> {
        return new Map(
            companyIds.map((id) => {
                const configured = this.counts.get(id) ?? {};

                return [
                    id,
                    {
                        ...(includes.includes("peopleCount")
                            ? { peopleCount: configured.peopleCount ?? 0 }
                            : {}),
                        ...(includes.includes("opportunitiesCount")
                            ? {
                                  opportunitiesCount:
                                      configured.opportunitiesCount ?? 0,
                              }
                            : {}),
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
    repository: InMemoryCompaniesRepository,
    customFields = new InMemoryCompanyCustomFields(),
    authResult: HttpAuthResult = authenticated(),
): CompaniesApiDependencies => ({
    auth: new StaticAuthResolver(authResult),
    companies: new CompaniesService(
        repository,
        customFields,
        () => now,
        () => companyId,
    ),
});

const apiRequest = (
    path: string,
    method = "GET",
    body?: unknown,
): Request =>
    new Request(`https://crm.example.test${path}`, {
        method,
        headers: {
            "x-request-id": "request-1",
            ...(["GET", "HEAD", "OPTIONS"].includes(method)
                ? {}
                : { "sec-fetch-site": "same-origin" }),
            ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

describe("API authentication and user resource", () => {
    it("maps authentication failures to forced JSON and returns the exact user resource", async () => {
        const unauthorized = await handleUserRequest(
            apiRequest("/api/v1/user"),
            new StaticAuthResolver({
                ok: false,
                failure: { reason: "credentials_missing", status: 401 },
            }),
        );

        expect(unauthorized.status).toBe(401);
        expect(unauthorized.headers.get("content-type")).toContain("json");
        await expect(unauthorized.json()).resolves.toEqual({
            message: "Unauthenticated.",
        });

        const response = await handleUserRequest(
            apiRequest("/api/v1/user"),
            new StaticAuthResolver(authenticated()),
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain(
            "application/vnd.api+json",
        );
        await expect(response.json()).resolves.toEqual({
            data: {
                id: userId,
                type: "users",
                attributes: {
                    name: "Ada Lovelace",
                    email: "ada@example.test",
                },
            },
        });
    });

    it("enforces the HTTP ability from RequestContext before invoking an action", async () => {
        const repository = new InMemoryCompaniesRepository();
        const response = await handleCompaniesCollectionRequest(
            apiRequest("/api/v1/companies", "POST", { name: "Blocked" }),
            dependencies(
                repository,
                new InMemoryCompanyCustomFields(),
                authenticated(requestContext(["read"])),
            ),
        );

        expect(response.status).toBe(403);
        expect(repository.createInputs).toEqual([]);
    });

    it("rejects cross-origin session writes but allows bearer-token writes", async () => {
        const repository = new InMemoryCompaniesRepository();
        const crossOriginRequest = new Request(
            "https://crm.example.test/api/v1/companies",
            {
                method: "POST",
                headers: {
                    origin: "https://attacker.example",
                    "content-type": "application/json",
                },
                body: JSON.stringify({ name: "Blocked" }),
            },
        );
        const sessionResponse = await handleCompaniesCollectionRequest(
            crossOriginRequest,
            dependencies(repository),
        );
        const tokenResponse = await handleCompaniesCollectionRequest(
            crossOriginRequest,
            dependencies(
                repository,
                new InMemoryCompanyCustomFields(),
                authenticated(
                    requestContext(["read", "create", "update", "delete"]),
                ),
            ),
        );

        expect(sessionResponse.status).toBe(419);
        await expect(sessionResponse.json()).resolves.toEqual({
            message: "CSRF token mismatch.",
        });
        expect(tokenResponse.status).toBe(201);
    });
});

describe("Companies actions", () => {
    it("composes company identity and prepared custom fields into one create transaction", async () => {
        const repository = new InMemoryCompaniesRepository();
        const customFields = new InMemoryCompanyCustomFields();
        const response = await handleCompaniesCollectionRequest(
            apiRequest("/api/v1/companies", "POST", {
                name: "  Acme Corp  ",
                team_id: otherTeamId,
                creator_id: ulid(99),
                custom_fields: { industry: "  Technology  " },
            }),
            dependencies(repository, customFields),
        );

        expect(response.status).toBe(201);
        expect(repository.createInputs).toHaveLength(1);
        expect(repository.createInputs[0]).toMatchObject({
            id: companyId,
            teamId,
            creatorId: userId,
            name: "Acme Corp",
            creationSource: "api",
            occurredAt: now,
            customFields: {
                teamId,
                entityType: "company",
                entityId: companyId,
                mutations: [
                    expect.objectContaining({
                        teamId,
                        entityType: "company",
                        entityId: companyId,
                        customFieldId,
                        textValue: "Technology",
                    }),
                ],
            },
        });
        await expect(response.json()).resolves.toEqual({
            data: {
                id: companyId,
                type: "companies",
                attributes: {
                    name: "Acme Corp",
                    creation_source: "api",
                    created_at: "2026-08-18T12:00:00.000000Z",
                    updated_at: "2026-08-18T12:00:00.000000Z",
                    custom_fields: { industry: "Technology" },
                },
            },
        });
    });

    it("distinguishes omitted update fields from submitted clears", async () => {
        const repository = new InMemoryCompaniesRepository([company()]);
        const customFields = new InMemoryCompanyCustomFields();
        customFields.seed(companyId, { industry: "Technology" });
        const response = await handleCompanyRequest(
            apiRequest(`/api/v1/companies/${companyId}`, "PATCH", {
                custom_fields: { industry: null },
            }),
            companyId,
            dependencies(repository, customFields),
        );

        expect(response.status).toBe(200);
        expect(repository.updateInputs[0]).not.toHaveProperty("name");
        expect(repository.updateInputs[0]?.customFields?.mutations[0]).toMatchObject({
            textValue: null,
        });
        expect(repository.records[0]?.name).toBe("Acme Corp");
        expect(
            (
                (await response.json()) as {
                    data: { attributes: { custom_fields: unknown } };
                }
            ).data.attributes.custom_fields,
        ).toEqual({ industry: null });
    });

    it("soft deletes through the service and hides the record afterwards", async () => {
        const repository = new InMemoryCompaniesRepository([company()]);
        const api = dependencies(repository);
        const deleted = await handleCompanyRequest(
            apiRequest(`/api/v1/companies/${companyId}`, "DELETE"),
            companyId,
            api,
        );
        const shown = await handleCompanyRequest(
            apiRequest(`/api/v1/companies/${companyId}`),
            companyId,
            api,
        );

        expect(deleted.status).toBe(204);
        expect(await deleted.text()).toBe("");
        expect(repository.deleted).toEqual([companyId]);
        expect(shown.status).toBe(404);
    });
});

describe("Companies isolation, validation, and resources", () => {
    it("returns the same not-found response for foreign and missing companies", async () => {
        const repository = new InMemoryCompaniesRepository([
            company({ id: otherCompanyId, teamId: otherTeamId }),
        ]);
        const api = dependencies(repository);
        const foreign = await handleCompanyRequest(
            apiRequest(`/api/v1/companies/${otherCompanyId}`),
            otherCompanyId,
            api,
        );
        const missingId = ulid(77);
        const missing = await handleCompanyRequest(
            apiRequest(`/api/v1/companies/${missingId}`),
            missingId,
            api,
        );
        const foreignWithInvalidBody = await handleCompanyRequest(
            apiRequest(`/api/v1/companies/${otherCompanyId}`, "PATCH", {
                name: null,
            }),
            otherCompanyId,
            api,
        );

        expect(foreign.status).toBe(404);
        expect(missing.status).toBe(404);
        expect(foreignWithInvalidBody.status).toBe(404);
        expect(await foreign.text()).toBe(await missing.text());
        expect(await handleCompanyRequest(
            apiRequest("/api/v1/companies/not-a-ulid"),
            "not-a-ulid",
            api,
        )).toMatchObject({ status: 404 });
    });

    it("maps native, malformed JSON, and custom-field validation failures", async () => {
        const api = dependencies(new InMemoryCompaniesRepository());
        const missingName = await handleCompaniesCollectionRequest(
            apiRequest("/api/v1/companies", "POST", {}),
            api,
        );
        const invalidCustomField = await handleCompaniesCollectionRequest(
            apiRequest("/api/v1/companies", "POST", {
                name: "Acme",
                custom_fields: { guessed_secret: "value" },
            }),
            api,
        );
        const malformed = await handleCompaniesCollectionRequest(
            new Request("https://crm.example.test/api/v1/companies", {
                method: "POST",
                headers: { "sec-fetch-site": "same-origin" },
                body: "{",
            }),
            api,
        );

        expect(missingName.status).toBe(422);
        await expect(missingName.json()).resolves.toMatchObject({
            errors: { name: ["The name field is required."] },
        });
        expect(invalidCustomField.status).toBe(422);
        await expect(invalidCustomField.json()).resolves.toEqual({
            message: "Unknown custom field keys: guessed_secret.",
            errors: {
                custom_fields: [
                    "Unknown custom field keys: guessed_secret.",
                ],
            },
        });
        expect(malformed.status).toBe(400);
        expect(malformed.headers.get("content-type")).toContain("json");
    });

    it("renders requested relationships and counts while keeping default resources sparse", async () => {
        const repository = new InMemoryCompaniesRepository([company()]);
        const customFields = new InMemoryCompanyCustomFields();
        customFields.seed(companyId, { industry: "Technology" });
        repository.people = [
            {
                id: personId,
                teamId,
                companyId,
                name: "Grace Hopper",
                creationSource: "api",
                createdAt: now,
                updatedAt: now,
            },
        ];
        repository.counts.set(companyId, { peopleCount: 1 });
        const api = dependencies(repository, customFields);
        const sparse = await handleCompanyRequest(
            apiRequest(`/api/v1/companies/${companyId}`),
            companyId,
            api,
        );
        const included = await handleCompanyRequest(
            apiRequest(
                `/api/v1/companies/${companyId}?include=creator,people,peopleCount`,
            ),
            companyId,
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
        expect(includedDocument.data.attributes.people_count).toBe(1);
        expect(includedDocument.data.relationships).toEqual({
            creator: { data: { id: userId, type: "users" } },
            people: { data: [{ id: personId, type: "people" }] },
        });
        expect(includedDocument.included).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: userId, type: "users" }),
                expect.objectContaining({ id: personId, type: "people" }),
            ]),
        );
    });
});

describe("Companies list parsing", () => {
    it("parses page pagination, filters, allowlisted sorts, and includes", () => {
        expect(
            parseCompanyListQuery(
                new URL(
                    "https://crm.example.test/api/v1/companies?per_page=25&page=2&filter[name]=Acme&filter[created_after]=2026-01-01&filter[created_before]=2026-08-18&sort=name,-updated_at&include=creator,peopleCount",
                ),
            ),
        ).toEqual({
            page: 2,
            perPage: 25,
            filters: {
                name: "Acme",
                createdAfter: "2026-01-01",
                createdBefore: "2026-08-18",
            },
            sorts: [
                { field: "name", direction: "asc" },
                { field: "updated_at", direction: "desc" },
            ],
            includes: ["creator", "peopleCount"],
        });
        expect(
            parseCompanyListQuery(
                new URL("https://crm.example.test/api/v1/companies"),
            ).sorts,
        ).toEqual([{ field: "created_at", direction: "desc" }]);
    });

    it.each([
        "filter[team_id]=secret",
        "sort=team_id",
        "include=secret",
        "cursor=true",
    ])("rejects unsupported query semantics: %s", async (query) => {
        const response = await handleCompaniesCollectionRequest(
            apiRequest(`/api/v1/companies?${query}`),
            dependencies(new InMemoryCompaniesRepository()),
        );

        expect(response.status).toBe(400);
    });

    it("returns Laravel-style 422 pagination errors and a stable paginated document", async () => {
        const invalid = await handleCompaniesCollectionRequest(
            apiRequest("/api/v1/companies?per_page=101"),
            dependencies(new InMemoryCompaniesRepository()),
        );
        const listed = await handleCompaniesCollectionRequest(
            apiRequest("/api/v1/companies?per_page=1&page=2"),
            dependencies(
                new InMemoryCompaniesRepository([
                    company(),
                    company({ id: ulid(55), name: "Beta" }),
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
