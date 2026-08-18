import { Buffer } from "node:buffer";

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
import type { Ulid } from "@/server/ids";
import { ulidSchema } from "@/server/ids";
import {
    handlePeopleCollectionRequest,
    handlePersonRequest,
    type PeopleApiDependencies,
} from "@/server/people/handler";
import { parsePeopleListQuery } from "@/server/people/query";
import type {
    CreatePeopleTransaction,
    PeopleRepository,
    UpdatePeopleTransaction,
} from "@/server/people/repository";
import {
    PeopleService,
    type PeopleCustomFieldsService,
} from "@/server/people/service";
import type {
    PeopleCompanyRecord,
    PeopleCountInclude,
    PeopleListPage,
    PeopleListQuery,
    PeopleRecord,
    PeopleRelationshipCounts,
    PeopleUserRecord,
} from "@/server/people/types";

const ulid = (sequence: number): Ulid =>
    ulidSchema.parse(`01J${sequence.toString().padStart(23, "0")}`);

const userId = ulid(1);
const teamId = ulid(2);
const otherTeamId = ulid(3);
const personId = ulid(4);
const otherPersonId = ulid(5);
const companyId = ulid(6);
const otherCompanyId = ulid(7);
const customFieldId = ulid(8);
const customFieldValueId = ulid(9);
const now = new Date("2026-08-18T12:00:00.000Z");

const requestContext = (
    abilities:
        readonly ("read" | "create" | "update" | "delete")[] | null = null,
): RequestContext =>
    createRequestContext({
        requestId: "request-people",
        userId,
        teamId,
        credential:
            abilities === null
                ? { kind: "session", sessionId: "session-people" }
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

class InMemoryPeopleCustomFields implements PeopleCustomFieldsService {
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
            (code) => code !== "role",
        );

        if (unknown.length > 0) {
            throw new CustomFieldValidationError([
                {
                    path: "custom_fields",
                    message: `Unknown custom field keys: ${unknown.join(", ")}.`,
                },
            ]);
        }

        const key = this.key(request.entityType, request.entityId);
        const existing = this.values.get(key) ?? {};
        const next = Object.hasOwn(submitted, "role")
            ? { ...existing, role: submitted.role as string | null }
            : existing;
        this.values.set(key, next);

        const mutations: readonly CustomFieldValueMutation[] = Object.hasOwn(
            submitted,
            "role",
        )
            ? [
                  {
                      id: customFieldValueId,
                      teamId: context.teamId,
                      entityType: "people",
                      entityId: request.entityId,
                      customFieldId,
                      ...emptyStorage(),
                      textValue:
                          typeof submitted.role === "string"
                              ? submitted.role
                              : null,
                  },
              ]
            : [];

        return {
            teamId: context.teamId,
            entityType: "people",
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
        return this.values.get(this.key(entityType, entityId)) ?? {};
    }

    public seed(
        entityType: "company" | "people" | "opportunity",
        entityId: Ulid,
        fields: CustomFieldsApiObject,
    ): void {
        this.values.set(this.key(entityType, entityId), fields);
    }

    private key(entityType: string, entityId: Ulid): string {
        return `${entityType}:${entityId}`;
    }
}

const person = (overrides: Partial<PeopleRecord> = {}): PeopleRecord => ({
    id: personId,
    teamId,
    creatorId: userId,
    companyId,
    name: "Grace Hopper",
    creationSource: "api",
    createdAt: now,
    updatedAt: now,
    ...overrides,
});

const company = (
    overrides: Partial<PeopleCompanyRecord> = {},
): PeopleCompanyRecord => ({
    id: companyId,
    teamId,
    name: "Compiler Systems",
    creationSource: "api",
    createdAt: now,
    updatedAt: now,
    ...overrides,
});

class InMemoryPeopleRepository implements PeopleRepository {
    public readonly createInputs: CreatePeopleTransaction[] = [];
    public readonly updateInputs: UpdatePeopleTransaction[] = [];
    public readonly deleted: Ulid[] = [];
    public readonly records: PeopleRecord[];
    public users: PeopleUserRecord[] = [
        { id: userId, name: "Ada Lovelace", email: "ada@example.test" },
    ];
    public companies: PeopleCompanyRecord[] = [company()];
    public counts = new Map<Ulid, PeopleRelationshipCounts>();

    public constructor(records: readonly PeopleRecord[] = []) {
        this.records = [...records];
    }

    public async list(
        requestedTeamId: Ulid,
        query: PeopleListQuery,
    ): Promise<PeopleListPage> {
        const allowedCustomFields = new Set(["score", "role"]);

        for (const filter of query.filters.customFields) {
            if (!allowedCustomFields.has(filter.code)) {
                throw new ApiBadRequestError(
                    `Requested custom field ${filter.code} is not filterable or sortable.`,
                );
            }
        }

        for (const sort of query.sorts) {
            if (
                !["name", "created_at", "updated_at"].includes(sort.field) &&
                !allowedCustomFields.has(sort.field)
            ) {
                throw new ApiBadRequestError(
                    `Requested custom field ${sort.field} is not filterable or sortable.`,
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

        if (query.sorts[0]?.field === "name") {
            const direction = query.sorts[0].direction === "asc" ? 1 : -1;
            records.sort(
                (left, right) =>
                    left.name.localeCompare(right.name) * direction,
            );
        }

        if (query.pagination.kind === "cursor") {
            return {
                kind: "cursor",
                records: records.slice(0, query.perPage),
                nextCursor:
                    records.length > query.perPage ? "next-cursor" : null,
                previousCursor: null,
            };
        }

        const total = records.length;
        const start = (query.pagination.page - 1) * query.perPage;

        return {
            kind: "page",
            records: records.slice(start, start + query.perPage),
            total,
        };
    }

    public async find(
        requestedTeamId: Ulid,
        requestedPersonId: Ulid,
    ): Promise<PeopleRecord | undefined> {
        return this.records.find(
            (record) =>
                record.id === requestedPersonId &&
                record.teamId === requestedTeamId &&
                !this.deleted.includes(record.id),
        );
    }

    public async companyExists(
        requestedTeamId: Ulid,
        requestedCompanyId: Ulid,
    ): Promise<boolean> {
        return this.companies.some(
            (record) =>
                record.id === requestedCompanyId &&
                record.teamId === requestedTeamId,
        );
    }

    public async create(input: CreatePeopleTransaction): Promise<PeopleRecord> {
        this.createInputs.push(input);
        const record = person({
            id: input.id,
            teamId: input.teamId,
            creatorId: input.creatorId,
            companyId: input.companyId,
            name: input.name,
            creationSource: input.creationSource,
            createdAt: input.occurredAt,
            updatedAt: input.occurredAt,
        });
        this.records.push(record);

        return record;
    }

    public async update(
        input: UpdatePeopleTransaction,
    ): Promise<PeopleRecord | undefined> {
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
            ...(Object.hasOwn(input, "companyId")
                ? { companyId: input.companyId ?? null }
                : {}),
            updatedAt: input.occurredAt,
        };
        this.records[index] = updated;

        return updated;
    }

    public async softDelete(
        requestedTeamId: Ulid,
        requestedPersonId: Ulid,
    ): Promise<boolean> {
        const existing = await this.find(requestedTeamId, requestedPersonId);

        if (existing === undefined) {
            return false;
        }

        this.deleted.push(requestedPersonId);

        return true;
    }

    public async loadUsers(
        requestedTeamId: Ulid,
        records: readonly PeopleRecord[],
    ): Promise<readonly PeopleUserRecord[]> {
        const ids = new Set(
            records
                .filter((record) => record.teamId === requestedTeamId)
                .map((record) => record.creatorId)
                .filter((id): id is Ulid => id !== null),
        );

        return this.users.filter((user) => ids.has(user.id));
    }

    public async loadCompanies(
        requestedTeamId: Ulid,
        companyIds: readonly Ulid[],
    ): Promise<readonly PeopleCompanyRecord[]> {
        return this.companies.filter(
            (record) =>
                record.teamId === requestedTeamId &&
                companyIds.includes(record.id),
        );
    }

    public async loadRelationshipCounts(
        _requestedTeamId: Ulid,
        personIds: readonly Ulid[],
        includes: readonly PeopleCountInclude[],
    ): Promise<ReadonlyMap<Ulid, PeopleRelationshipCounts>> {
        return new Map(
            personIds.map((id) => {
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
    repository: InMemoryPeopleRepository,
    customFields = new InMemoryPeopleCustomFields(),
    authResult: HttpAuthResult = authenticated(),
): PeopleApiDependencies => ({
    auth: new StaticAuthResolver(authResult),
    people: new PeopleService(
        repository,
        customFields,
        () => now,
        () => personId,
    ),
});

const apiRequest = (path: string, method = "GET", body?: unknown): Request =>
    new Request(`https://crm.example.test${path}`, {
        method,
        headers: {
            "x-request-id": "request-people",
            ...(["GET", "HEAD", "OPTIONS"].includes(method)
                ? {}
                : { "sec-fetch-site": "same-origin" }),
            ...(body === undefined
                ? {}
                : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

describe("People API workflow", () => {
    it("maps the shared HTTP ability before invoking a write workflow", async () => {
        const repository = new InMemoryPeopleRepository();
        const response = await handlePeopleCollectionRequest(
            apiRequest("/api/v1/people", "POST", { name: "Blocked" }),
            dependencies(
                repository,
                new InMemoryPeopleCustomFields(),
                authenticated(requestContext(["read"])),
            ),
        );

        expect(response.status).toBe(403);
        expect(repository.createInputs).toEqual([]);
    });

    it("composes creator, source, tenant FK, and custom fields into one create transaction", async () => {
        const repository = new InMemoryPeopleRepository();
        const customFields = new InMemoryPeopleCustomFields();
        customFields.seed("company", companyId, { segment: "Enterprise" });
        const response = await handlePeopleCollectionRequest(
            apiRequest("/api/v1/people?include=creator,company", "POST", {
                name: "  Grace Hopper  ",
                company_id: companyId,
                team_id: otherTeamId,
                creator_id: ulid(99),
                custom_fields: { role: "  Engineering Leader  " },
            }),
            dependencies(repository, customFields),
        );

        expect(response.status).toBe(201);
        expect(repository.createInputs).toHaveLength(1);
        expect(repository.createInputs[0]).toMatchObject({
            id: personId,
            teamId,
            creatorId: userId,
            companyId,
            name: "Grace Hopper",
            creationSource: "api",
            occurredAt: now,
            customFields: {
                teamId,
                entityType: "people",
                entityId: personId,
                mutations: [
                    expect.objectContaining({
                        teamId,
                        entityType: "people",
                        entityId: personId,
                        customFieldId,
                        textValue: "Engineering Leader",
                    }),
                ],
            },
        });
        await expect(response.json()).resolves.toEqual({
            data: {
                id: personId,
                type: "people",
                attributes: {
                    name: "Grace Hopper",
                    company_id: companyId,
                    creation_source: "api",
                    created_at: "2026-08-18T12:00:00.000000Z",
                    updated_at: "2026-08-18T12:00:00.000000Z",
                    custom_fields: { role: "Engineering Leader" },
                },
                relationships: {
                    creator: { data: { id: userId, type: "users" } },
                    company: { data: { id: companyId, type: "companies" } },
                },
            },
            included: expect.arrayContaining([
                expect.objectContaining({ id: userId, type: "users" }),
                expect.objectContaining({
                    id: companyId,
                    type: "companies",
                    attributes: expect.objectContaining({
                        custom_fields: { segment: "Enterprise" },
                    }),
                }),
            ]),
        });
    });

    it("rejects a foreign company FK without preparing or persisting custom fields", async () => {
        const repository = new InMemoryPeopleRepository();
        repository.companies.push(
            company({ id: otherCompanyId, teamId: otherTeamId }),
        );
        const customFields = new InMemoryPeopleCustomFields();
        const response = await handlePeopleCollectionRequest(
            apiRequest("/api/v1/people", "POST", {
                name: "Tenant Escape",
                company_id: otherCompanyId,
                custom_fields: { role: "Intruder" },
            }),
            dependencies(repository, customFields),
        );

        expect(response.status).toBe(422);
        await expect(response.json()).resolves.toMatchObject({
            errors: { company_id: [expect.stringContaining("invalid")] },
        });
        expect(customFields.prepareCalls).toEqual([]);
        expect(repository.createInputs).toEqual([]);
    });

    it("distinguishes omitted updates from explicit company and custom-field clears", async () => {
        const repository = new InMemoryPeopleRepository([person()]);
        const customFields = new InMemoryPeopleCustomFields();
        customFields.seed("people", personId, { role: "Engineer" });
        const response = await handlePersonRequest(
            apiRequest(`/api/v1/people/${personId}`, "PATCH", {
                company_id: null,
                custom_fields: { role: null },
            }),
            personId,
            dependencies(repository, customFields),
        );

        expect(response.status).toBe(200);
        expect(repository.updateInputs[0]).not.toHaveProperty("name");
        expect(repository.updateInputs[0]).toMatchObject({ companyId: null });
        expect(
            repository.updateInputs[0]?.customFields?.mutations[0],
        ).toMatchObject({
            textValue: null,
        });
        expect(repository.records[0]).toMatchObject({
            name: "Grace Hopper",
            companyId: null,
        });
        await expect(response.json()).resolves.toMatchObject({
            data: {
                attributes: {
                    company_id: null,
                    custom_fields: { role: null },
                },
            },
        });
    });

    it("returns identical 404s for foreign, missing, malformed, and deleted people", async () => {
        const repository = new InMemoryPeopleRepository([
            person({ id: otherPersonId, teamId: otherTeamId }),
            person(),
        ]);
        const api = dependencies(repository);
        const foreign = await handlePersonRequest(
            apiRequest(`/api/v1/people/${otherPersonId}`),
            otherPersonId,
            api,
        );
        const missingId = ulid(77);
        const missing = await handlePersonRequest(
            apiRequest(`/api/v1/people/${missingId}`),
            missingId,
            api,
        );
        const malformed = await handlePersonRequest(
            apiRequest("/api/v1/people/not-a-ulid"),
            "not-a-ulid",
            api,
        );
        const deleted = await handlePersonRequest(
            apiRequest(`/api/v1/people/${personId}`, "DELETE"),
            personId,
            api,
        );
        const afterDelete = await handlePersonRequest(
            apiRequest(`/api/v1/people/${personId}`),
            personId,
            api,
        );

        expect(foreign.status).toBe(404);
        expect(missing.status).toBe(404);
        expect(malformed.status).toBe(404);
        expect(await foreign.text()).toBe(await missing.text());
        expect(deleted.status).toBe(204);
        expect(await deleted.text()).toBe("");
        expect(repository.deleted).toEqual([personId]);
        expect(afterDelete.status).toBe(404);
    });

    it("renders requested nullable relationships and counts while sparse fields stay exact", async () => {
        const repository = new InMemoryPeopleRepository([
            person(),
            person({ id: ulid(20), companyId: null, creatorId: null }),
        ]);
        repository.counts.set(personId, { tasksCount: 3, notesCount: 2 });
        const api = dependencies(repository);
        const included = await handlePersonRequest(
            apiRequest(
                `/api/v1/people/${personId}?include=creator,company,tasksCount,notesCount`,
            ),
            personId,
            api,
        );
        const sparse = await handlePersonRequest(
            apiRequest(
                `/api/v1/people/${personId}?include=creator,company,tasksCount&fields[people]=name,company_id`,
            ),
            personId,
            api,
        );
        const nullable = await handlePersonRequest(
            apiRequest(`/api/v1/people/${ulid(20)}?include=creator,company`),
            ulid(20),
            api,
        );
        const includedDocument = (await included.json()) as {
            data: {
                attributes: Record<string, unknown>;
                relationships: Record<string, unknown>;
            };
        };
        const sparseDocument = (await sparse.json()) as {
            data: { attributes: Record<string, unknown> };
        };

        expect(includedDocument.data.attributes).toMatchObject({
            tasks_count: 3,
            notes_count: 2,
        });
        expect(includedDocument.data.relationships).toEqual({
            creator: { data: { id: userId, type: "users" } },
            company: { data: { id: companyId, type: "companies" } },
        });
        expect(sparseDocument.data.attributes).toEqual({
            name: "Grace Hopper",
            company_id: companyId,
        });
        await expect(nullable.json()).resolves.toMatchObject({
            data: {
                relationships: {
                    creator: { data: null },
                    company: { data: null },
                },
            },
        });
    });
});

describe("People list query contract", () => {
    it("parses pagination, all native filters, custom filters, sorts, includes, and fields", () => {
        expect(
            parsePeopleListQuery(
                new URL(
                    `https://crm.example.test/api/v1/people?per_page=25&page=2&filter[name]=Grace&filter[company_id]=${companyId}&filter[created_after]=2026-01-01&filter[created_before]=2026-08-18&filter[custom_fields][role][contains]=engineer&filter[custom_fields][score][gte]=3&sort=name,-score&include=creator,company,tasksCount,notesCount&fields[people]=id,name,company_id`,
                ),
            ),
        ).toEqual({
            pagination: { kind: "page", page: 2 },
            perPage: 25,
            filters: {
                name: "Grace",
                companyId,
                createdAfter: "2026-01-01",
                createdBefore: "2026-08-18",
                customFields: [
                    { code: "role", operator: "contains", operand: "engineer" },
                    { code: "score", operator: "gte", operand: "3" },
                ],
            },
            sorts: [
                { field: "name", direction: "asc" },
                { field: "score", direction: "desc" },
            ],
            includes: ["creator", "company", "tasksCount", "notesCount"],
            fields: ["id", "name", "company_id"],
        });
    });

    it("supports the cursor bootstrap and emits the Laravel cursor resource shape", async () => {
        const repository = new InMemoryPeopleRepository([
            person(),
            person({ id: ulid(21), name: "Katherine Johnson" }),
            person({ id: ulid(22), name: "Margaret Hamilton" }),
        ]);
        const response = await handlePeopleCollectionRequest(
            apiRequest("/api/v1/people?cursor=true&per_page=2&sort=name"),
            dependencies(repository),
        );
        const document = (await response.json()) as {
            data: readonly unknown[];
            links: Record<string, unknown>;
            meta: Record<string, unknown>;
        };

        expect(response.status).toBe(200);
        expect(document.data).toHaveLength(2);
        expect(document.links).toMatchObject({
            first: null,
            last: null,
            prev: null,
            next: expect.any(String),
        });
        expect(document.meta).toMatchObject({
            per_page: 2,
            next_cursor: "next-cursor",
            prev_cursor: null,
        });
    });

    it("accepts an in-flight Laravel cursor for the same sort", () => {
        const cursor = Buffer.from(
            JSON.stringify({
                name: "Grace Hopper",
                id: personId,
                _pointsToNextItems: true,
            }),
        )
            .toString("base64url")
            .replace(/=+$/u, "");

        expect(
            parsePeopleListQuery(
                new URL(
                    `https://crm.example.test/api/v1/people?sort=name&cursor=${cursor}`,
                ),
            ).pagination,
        ).toEqual({
            kind: "cursor",
            cursor: {
                values: ["Grace Hopper"],
                id: personId,
                pointsToNextItems: true,
            },
        });
    });

    it("parses custom-field arrays and accepts an empty custom filter", () => {
        expect(
            parsePeopleListQuery(
                new URL(
                    "https://crm.example.test/api/v1/people?filter[custom_fields][role][in][1]=sales,success&filter[custom_fields][role][in][0]=engineering",
                ),
            ).filters.customFields,
        ).toEqual([
            {
                code: "role",
                operator: "in",
                operand: ["sales", "success", "engineering"],
            },
        ]);
        expect(
            parsePeopleListQuery(
                new URL(
                    "https://crm.example.test/api/v1/people?filter[custom_fields]=",
                ),
            ).filters.customFields,
        ).toEqual([]);
    });

    it.each([
        "filter[team_id]=secret",
        "filter[custom_fields][secret][eq]=value",
        "sort=secret",
        "include=secret",
        "fields[people]=secret",
        "fields[companies]=name",
        "cursor=not-a-cursor",
        "unknown=value",
        "filter[custom_fields][role][eq][]=engineer",
    ])(
        "rejects unsupported query semantics instead of omitting them: %s",
        async (query) => {
            const response = await handlePeopleCollectionRequest(
                apiRequest(`/api/v1/people?${query}`),
                dependencies(new InMemoryPeopleRepository()),
            );

            expect(response.status).toBe(400);
        },
    );

    it("returns Laravel-style validation errors for pagination and request data", async () => {
        const api = dependencies(new InMemoryPeopleRepository());
        const pagination = await handlePeopleCollectionRequest(
            apiRequest("/api/v1/people?per_page=101"),
            api,
        );
        const missingName = await handlePeopleCollectionRequest(
            apiRequest("/api/v1/people", "POST", {}),
            api,
        );
        const invalidCompany = await handlePeopleCollectionRequest(
            apiRequest("/api/v1/people", "POST", {
                name: "Invalid Company",
                company_id: "not-an-id",
            }),
            api,
        );

        expect(pagination.status).toBe(422);
        await expect(pagination.json()).resolves.toMatchObject({
            errors: { per_page: [expect.stringContaining("100")] },
        });
        expect(missingName.status).toBe(422);
        await expect(missingName.json()).resolves.toMatchObject({
            errors: { name: [expect.stringContaining("required")] },
        });
        expect(invalidCompany.status).toBe(422);
        await expect(invalidCompany.json()).resolves.toMatchObject({
            errors: { company_id: [expect.stringContaining("invalid")] },
        });
    });
});
