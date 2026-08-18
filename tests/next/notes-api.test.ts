import { describe, expect, it } from "vitest";

import { ApiValidationError } from "@/server/api/errors";
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
    handleNoteRequest,
    handleNotesCollectionRequest,
    type NotesApiDependencies,
} from "@/server/notes/handler";
import { parseNoteListQuery } from "@/server/notes/query";
import type {
    CreateNoteTransaction,
    NotesRepository,
    UpdateNoteTransaction,
} from "@/server/notes/repository";
import {
    NotesService,
    type NoteCustomFieldsService,
} from "@/server/notes/service";
import {
    noteableTypes,
    type NoteCompanyRecord,
    type NoteCountInclude,
    type NoteListPage,
    type NoteListQuery,
    type NoteOpportunityRecord,
    type NotePersonRecord,
    type NoteRecord,
    type NoteRelationshipCounts,
    type NoteRelationshipSyncs,
    type NoteUserRecord,
    type NoteableType,
} from "@/server/notes/types";

const ulid = (sequence: number): Ulid =>
    ulidSchema.parse(`01J${sequence.toString().padStart(23, "0")}`);

const userId = ulid(1);
const teamId = ulid(2);
const otherTeamId = ulid(3);
const noteId = ulid(4);
const otherNoteId = ulid(5);
const companyId = ulid(6);
const personId = ulid(7);
const opportunityId = ulid(8);
const customFieldId = ulid(9);
const customFieldValueId = ulid(10);
const foreignCompanyId = ulid(11);
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

class InMemoryNoteCustomFields implements NoteCustomFieldsService {
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
            (code) => code !== "summary",
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
        const next = Object.hasOwn(submitted, "summary")
            ? { ...existing, summary: submitted.summary as string | null }
            : existing;
        this.values.set(key, next);

        const mutations: readonly CustomFieldValueMutation[] = Object.hasOwn(
            submitted,
            "summary",
        )
            ? [
                  {
                      id: customFieldValueId,
                      teamId: context.teamId,
                      entityType: request.entityType,
                      entityId: request.entityId,
                      customFieldId,
                      ...emptyStorage(),
                      textValue:
                          typeof submitted.summary === "string"
                              ? submitted.summary
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
        entityType: "company" | "people" | "opportunity" | "note",
        entityId: Ulid,
    ): Promise<CustomFieldsApiObject> {
        return this.values.get(`${entityType}:${entityId}`) ?? {};
    }

    public seed(
        entityType: "company" | "people" | "opportunity" | "note",
        entityId: Ulid,
        fields: CustomFieldsApiObject,
    ): void {
        this.values.set(`${entityType}:${entityId}`, fields);
    }
}

const note = (overrides: Partial<NoteRecord> = {}): NoteRecord => ({
    id: noteId,
    teamId,
    creatorId: userId,
    title: "Discovery call",
    creationSource: "api",
    createdAt: now,
    updatedAt: now,
    ...overrides,
});

type MutableRelationships = Partial<Record<NoteableType, Ulid[]>>;

class InMemoryNotesRepository implements NotesRepository {
    public readonly createInputs: CreateNoteTransaction[] = [];
    public readonly updateInputs: UpdateNoteTransaction[] = [];
    public readonly deleted: Ulid[] = [];
    public readonly records: NoteRecord[];
    public readonly relationships = new Map<Ulid, MutableRelationships>();
    public readonly owned = new Map<string, Set<Ulid>>();
    public users: NoteUserRecord[] = [
        { id: userId, name: "Ada Lovelace", email: "ada@example.test" },
    ];
    public companies: NoteCompanyRecord[] = [];
    public people: NotePersonRecord[] = [];
    public opportunities: NoteOpportunityRecord[] = [];

    public constructor(records: readonly NoteRecord[] = []) {
        this.records = [...records];
    }

    public own(
        ownedTeamId: Ulid,
        type: NoteableType,
        ...ids: readonly Ulid[]
    ): void {
        this.owned.set(`${ownedTeamId}:${type}`, new Set(ids));
    }

    public relationIds(recordId: Ulid, type: NoteableType): readonly Ulid[] {
        return this.relationships.get(recordId)?.[type] ?? [];
    }

    public async list(
        requestedTeamId: Ulid,
        query: NoteListQuery,
    ): Promise<NoteListPage> {
        let records = this.records.filter(
            (record) =>
                record.teamId === requestedTeamId &&
                !this.deleted.includes(record.id),
        );

        if (query.filters.title !== undefined) {
            const title = query.filters.title.toLocaleLowerCase();
            records = records.filter((record) =>
                record.title.toLocaleLowerCase().includes(title),
            );
        }

        if (query.filters.notableType !== undefined) {
            records = records.filter(
                (record) =>
                    this.relationIds(record.id, query.filters.notableType!)
                        .length > 0,
            );
        }

        if (query.filters.notableId !== undefined) {
            records = records.filter((record) =>
                noteableTypes.some((type) =>
                    this.relationIds(record.id, type).includes(
                        query.filters.notableId!,
                    ),
                ),
            );
        }

        for (const sort of [...query.sorts].reverse()) {
            records.sort((left, right) => {
                const leftValue =
                    sort.field === "title"
                        ? left.title
                        : sort.field === "created_at"
                          ? (left.createdAt?.toISOString() ?? "")
                          : (left.updatedAt?.toISOString() ?? "");
                const rightValue =
                    sort.field === "title"
                        ? right.title
                        : sort.field === "created_at"
                          ? (right.createdAt?.toISOString() ?? "")
                          : (right.updatedAt?.toISOString() ?? "");
                const compared = leftValue.localeCompare(rightValue);

                return sort.direction === "asc" ? compared : -compared;
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
        requestedNoteId: Ulid,
    ): Promise<NoteRecord | undefined> {
        return this.records.find(
            (record) =>
                record.id === requestedNoteId &&
                record.teamId === requestedTeamId &&
                !this.deleted.includes(record.id),
        );
    }

    public async findOwnedRelationshipIds(
        requestedTeamId: Ulid,
        type: NoteableType,
        ids: readonly Ulid[],
    ): Promise<ReadonlySet<Ulid>> {
        const owned = this.owned.get(`${requestedTeamId}:${type}`) ?? new Set();

        return new Set(ids.filter((id) => owned.has(id)));
    }

    public async create(input: CreateNoteTransaction): Promise<NoteRecord> {
        this.createInputs.push(input);
        const record = note({
            id: input.id,
            teamId: input.teamId,
            creatorId: input.creatorId,
            title: input.title,
            creationSource: input.creationSource,
            createdAt: input.occurredAt,
            updatedAt: input.occurredAt,
        });
        this.records.push(record);
        this.applyRelationships(record.id, input.relationships);

        return record;
    }

    public async update(
        input: UpdateNoteTransaction,
    ): Promise<NoteRecord | undefined> {
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
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.title === undefined && input.customFields === undefined
                ? {}
                : { updatedAt: input.occurredAt }),
        };
        this.records[index] = updated;
        this.applyRelationships(input.id, input.relationships);

        return updated;
    }

    public async softDelete(
        requestedTeamId: Ulid,
        requestedNoteId: Ulid,
    ): Promise<boolean> {
        const exists = await this.find(requestedTeamId, requestedNoteId);

        if (exists === undefined) {
            return false;
        }

        this.deleted.push(requestedNoteId);

        return true;
    }

    public async loadUsers(
        requestedTeamId: Ulid,
        noteRecords: readonly NoteRecord[],
    ): Promise<readonly NoteUserRecord[]> {
        const userIds = new Set(
            noteRecords
                .filter((record) => record.teamId === requestedTeamId)
                .map((record) => record.creatorId)
                .filter((id): id is Ulid => id !== null),
        );

        return this.users.filter((user) => userIds.has(user.id));
    }

    public async loadCompanies(
        requestedTeamId: Ulid,
        noteIds: readonly Ulid[],
    ): Promise<readonly NoteCompanyRecord[]> {
        return this.companies.filter(
            (company) =>
                company.teamId === requestedTeamId &&
                noteIds.includes(company.noteId) &&
                this.relationIds(company.noteId, "company").includes(
                    company.id,
                ),
        );
    }

    public async loadPeople(
        requestedTeamId: Ulid,
        noteIds: readonly Ulid[],
    ): Promise<readonly NotePersonRecord[]> {
        return this.people.filter(
            (person) =>
                person.teamId === requestedTeamId &&
                noteIds.includes(person.noteId) &&
                this.relationIds(person.noteId, "people").includes(person.id),
        );
    }

    public async loadOpportunities(
        requestedTeamId: Ulid,
        noteIds: readonly Ulid[],
    ): Promise<readonly NoteOpportunityRecord[]> {
        return this.opportunities.filter(
            (opportunity) =>
                opportunity.teamId === requestedTeamId &&
                noteIds.includes(opportunity.noteId) &&
                this.relationIds(opportunity.noteId, "opportunity").includes(
                    opportunity.id,
                ),
        );
    }

    public async loadRelationshipCounts(
        _requestedTeamId: Ulid,
        noteIds: readonly Ulid[],
        includes: readonly NoteCountInclude[],
    ): Promise<ReadonlyMap<Ulid, NoteRelationshipCounts>> {
        return new Map(
            noteIds.map((id) => [
                id,
                {
                    ...(includes.includes("companiesCount")
                        ? {
                              companiesCount: this.relationIds(id, "company")
                                  .length,
                          }
                        : {}),
                    ...(includes.includes("peopleCount")
                        ? { peopleCount: this.relationIds(id, "people").length }
                        : {}),
                    ...(includes.includes("opportunitiesCount")
                        ? {
                              opportunitiesCount: this.relationIds(
                                  id,
                                  "opportunity",
                              ).length,
                          }
                        : {}),
                },
            ]),
        );
    }

    private applyRelationships(
        recordId: Ulid,
        relationships: NoteRelationshipSyncs,
    ): void {
        const current = this.relationships.get(recordId) ?? {};

        for (const type of noteableTypes) {
            const ids = relationships[type];

            if (ids !== undefined) {
                current[type] = [...new Set(ids)];
            }
        }

        this.relationships.set(recordId, current);
    }
}

const dependencies = (
    repository: InMemoryNotesRepository,
    customFields = new InMemoryNoteCustomFields(),
    authResult: HttpAuthResult = authenticated(),
): NotesApiDependencies => ({
    auth: new StaticAuthResolver(authResult),
    notes: new NotesService(
        repository,
        customFields,
        () => now,
        () => noteId,
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

describe("Notes API actions", () => {
    it("composes source, creator, relationships, and custom fields into one create transaction", async () => {
        const repository = new InMemoryNotesRepository();
        repository.own(teamId, "company", companyId);
        repository.own(teamId, "people", personId);
        repository.own(teamId, "opportunity", opportunityId);
        const customFields = new InMemoryNoteCustomFields();
        const response = await handleNotesCollectionRequest(
            apiRequest("/api/v1/notes", "POST", {
                title: "  Discovery call  ",
                team_id: otherTeamId,
                creator_id: ulid(99),
                company_ids: [companyId],
                people_ids: [personId],
                opportunity_ids: [opportunityId],
                custom_fields: { summary: "  Qualified lead  " },
            }),
            dependencies(repository, customFields),
        );

        expect(response.status).toBe(201);
        expect(repository.createInputs).toHaveLength(1);
        expect(repository.createInputs[0]).toMatchObject({
            id: noteId,
            teamId,
            creatorId: userId,
            title: "Discovery call",
            creationSource: "api",
            relationships: {
                company: [companyId],
                people: [personId],
                opportunity: [opportunityId],
            },
            customFields: {
                teamId,
                entityType: "note",
                entityId: noteId,
                mutations: [
                    expect.objectContaining({
                        teamId,
                        entityType: "note",
                        entityId: noteId,
                        textValue: "Qualified lead",
                    }),
                ],
            },
        });
        await expect(response.json()).resolves.toEqual({
            data: {
                id: noteId,
                type: "notes",
                attributes: {
                    title: "Discovery call",
                    creation_source: "api",
                    created_at: "2026-08-18T12:00:00.000000Z",
                    updated_at: "2026-08-18T12:00:00.000000Z",
                    custom_fields: { summary: "Qualified lead" },
                },
            },
        });
    });

    it("updates fields, clears submitted custom fields, and soft deletes", async () => {
        const repository = new InMemoryNotesRepository([note()]);
        const customFields = new InMemoryNoteCustomFields();
        customFields.seed("note", noteId, { summary: "Qualified lead" });
        const api = dependencies(repository, customFields);
        const updated = await handleNoteRequest(
            apiRequest(`/api/v1/notes/${noteId}`, "PATCH", {
                title: "Follow-up",
                custom_fields: { summary: null },
            }),
            noteId,
            api,
        );
        const deleted = await handleNoteRequest(
            apiRequest(`/api/v1/notes/${noteId}`, "DELETE"),
            noteId,
            api,
        );
        const shown = await handleNoteRequest(
            apiRequest(`/api/v1/notes/${noteId}`),
            noteId,
            api,
        );

        expect(updated.status).toBe(200);
        expect(
            repository.updateInputs[0]?.customFields?.mutations[0],
        ).toMatchObject({
            textValue: null,
        });
        expect(
            (
                (await updated.json()) as {
                    data: {
                        attributes: { title: string; custom_fields: unknown };
                    };
                }
            ).data.attributes,
        ).toMatchObject({
            title: "Follow-up",
            custom_fields: { summary: null },
        });
        expect(deleted.status).toBe(204);
        expect(await deleted.text()).toBe("");
        expect(shown.status).toBe(404);
    });

    it("enforces authentication and token abilities before writes", async () => {
        const repository = new InMemoryNotesRepository();
        const unauthenticated = await handleNotesCollectionRequest(
            apiRequest("/api/v1/notes"),
            dependencies(repository, new InMemoryNoteCustomFields(), {
                ok: false,
                failure: { reason: "credentials_missing", status: 401 },
            }),
        );
        const forbidden = await handleNotesCollectionRequest(
            apiRequest("/api/v1/notes", "POST", { title: "Blocked" }),
            dependencies(
                repository,
                new InMemoryNoteCustomFields(),
                authenticated(requestContext(["read"])),
            ),
        );

        expect(unauthenticated.status).toBe(401);
        expect(forbidden.status).toBe(403);
        expect(repository.createInputs).toEqual([]);
    });
});

describe("Notes route-independent relationship workflows", () => {
    it("clears only explicitly submitted relation arrays and preserves omitted types", async () => {
        const repository = new InMemoryNotesRepository([note()]);
        repository.own(teamId, "company", companyId);
        repository.own(teamId, "people", personId);
        repository.own(teamId, "opportunity", opportunityId);
        repository.relationships.set(noteId, {
            company: [companyId],
            people: [personId],
            opportunity: [opportunityId],
        });
        const service = new NotesService(
            repository,
            new InMemoryNoteCustomFields(),
            () => now,
            () => noteId,
        );

        await service.update(requestContext(), noteId, { company_ids: [] }, []);

        expect(repository.updateInputs[0]?.relationships).toEqual({
            company: [],
        });
        expect(repository.relationIds(noteId, "company")).toEqual([]);
        expect(repository.relationIds(noteId, "people")).toEqual([personId]);
        expect(repository.relationIds(noteId, "opportunity")).toEqual([
            opportunityId,
        ]);
    });

    it("rejects foreign relation ids before create or update reaches a write transaction", async () => {
        const repository = new InMemoryNotesRepository([note()]);
        repository.own(otherTeamId, "company", foreignCompanyId);
        const service = new NotesService(
            repository,
            new InMemoryNoteCustomFields(),
            () => now,
            () => otherNoteId,
        );

        await expect(
            service.create(
                requestContext(),
                { title: "Unsafe", company_ids: [foreignCompanyId] },
                [],
            ),
        ).rejects.toMatchObject({
            issues: [expect.objectContaining({ path: "company_ids.0" })],
        });
        await expect(
            service.update(
                requestContext(),
                noteId,
                { people_ids: [foreignCompanyId] },
                [],
            ),
        ).rejects.toBeInstanceOf(ApiValidationError);
        expect(repository.createInputs).toEqual([]);
        expect(repository.updateInputs).toEqual([]);
    });
});

describe("Notes isolation, validation, and resources", () => {
    it("returns indistinguishable 404 responses for foreign, missing, invalid, and deleted notes", async () => {
        const repository = new InMemoryNotesRepository([
            note({ id: otherNoteId, teamId: otherTeamId }),
            note(),
        ]);
        repository.deleted.push(noteId);
        const api = dependencies(repository);
        const foreign = await handleNoteRequest(
            apiRequest(`/api/v1/notes/${otherNoteId}`),
            otherNoteId,
            api,
        );
        const foreignUpdate = await handleNoteRequest(
            apiRequest(`/api/v1/notes/${otherNoteId}`, "PATCH", {
                title: null,
            }),
            otherNoteId,
            api,
        );
        const missingId = ulid(70);
        const missing = await handleNoteRequest(
            apiRequest(`/api/v1/notes/${missingId}`),
            missingId,
            api,
        );
        const invalid = await handleNoteRequest(
            apiRequest("/api/v1/notes/not-a-ulid"),
            "not-a-ulid",
            api,
        );
        const deleted = await handleNoteRequest(
            apiRequest(`/api/v1/notes/${noteId}`),
            noteId,
            api,
        );

        expect(
            [foreign, foreignUpdate, missing, invalid, deleted].map(
                (response) => response.status,
            ),
        ).toEqual([404, 404, 404, 404, 404]);
        expect(await foreign.text()).toBe(await missing.text());
        expect(repository.updateInputs).toEqual([]);
    });

    it("validates titles, relation arrays, per-item ownership, and custom fields", async () => {
        const repository = new InMemoryNotesRepository();
        repository.own(teamId, "company", companyId);
        const api = dependencies(repository);
        const missingTitle = await handleNotesCollectionRequest(
            apiRequest("/api/v1/notes", "POST", {}),
            api,
        );
        const invalidArray = await handleNotesCollectionRequest(
            apiRequest("/api/v1/notes", "POST", {
                title: "Invalid",
                company_ids: companyId,
            }),
            api,
        );
        const invalidItem = await handleNotesCollectionRequest(
            apiRequest("/api/v1/notes", "POST", {
                title: "Invalid",
                company_ids: [companyId, foreignCompanyId, companyId],
            }),
            api,
        );
        const invalidCustomField = await handleNotesCollectionRequest(
            apiRequest("/api/v1/notes", "POST", {
                title: "Invalid",
                custom_fields: { guessed: "secret" },
            }),
            api,
        );

        expect(missingTitle.status).toBe(422);
        await expect(missingTitle.json()).resolves.toMatchObject({
            errors: { title: [expect.stringContaining("required")] },
        });
        expect(invalidArray.status).toBe(422);
        await expect(invalidArray.json()).resolves.toHaveProperty(
            "errors.company_ids",
        );
        expect(invalidItem.status).toBe(422);
        await expect(invalidItem.json()).resolves.toMatchObject({
            errors: { "company_ids.1": [expect.stringContaining("invalid")] },
        });
        expect(invalidCustomField.status).toBe(422);
        await expect(invalidCustomField.json()).resolves.toHaveProperty(
            "errors.custom_fields",
        );
    });

    it("renders requested relationships and counts while default resources stay sparse", async () => {
        const repository = new InMemoryNotesRepository([note()]);
        repository.relationships.set(noteId, {
            company: [companyId],
            people: [personId],
            opportunity: [opportunityId],
        });
        repository.companies = [
            {
                noteId,
                id: companyId,
                teamId,
                name: "Acme Corp",
                creationSource: "api",
                createdAt: now,
                updatedAt: now,
            },
        ];
        repository.people = [
            {
                noteId,
                id: personId,
                teamId,
                companyId,
                name: "Grace Hopper",
                creationSource: "api",
                createdAt: now,
                updatedAt: now,
            },
        ];
        repository.opportunities = [
            {
                noteId,
                id: opportunityId,
                teamId,
                companyId,
                contactId: personId,
                name: "Platform rollout",
                creationSource: "api",
                createdAt: now,
                updatedAt: now,
            },
        ];
        const customFields = new InMemoryNoteCustomFields();
        customFields.seed("company", companyId, { summary: "Customer" });
        const api = dependencies(repository, customFields);
        const sparse = await handleNoteRequest(
            apiRequest(`/api/v1/notes/${noteId}`),
            noteId,
            api,
        );
        const included = await handleNoteRequest(
            apiRequest(
                `/api/v1/notes/${noteId}?include=creator,companies,people,opportunities,companiesCount,peopleCount,opportunitiesCount`,
            ),
            noteId,
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
            companies_count: 1,
            people_count: 1,
            opportunities_count: 1,
        });
        expect(includedDocument.data.relationships).toMatchObject({
            creator: { data: { id: userId, type: "users" } },
            companies: { data: [{ id: companyId, type: "companies" }] },
            people: { data: [{ id: personId, type: "people" }] },
            opportunities: {
                data: [{ id: opportunityId, type: "opportunities" }],
            },
        });
        expect(includedDocument.included).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: userId, type: "users" }),
                expect.objectContaining({ id: companyId, type: "companies" }),
                expect.objectContaining({ id: personId, type: "people" }),
                expect.objectContaining({
                    id: opportunityId,
                    type: "opportunities",
                }),
            ]),
        );
    });
});

describe("Notes list parsing and pagination", () => {
    it("parses notable, title, date filters, sorts, includes, and page pagination", () => {
        expect(
            parseNoteListQuery(
                new URL(
                    `https://crm.example.test/api/v1/notes?per_page=25&page=2&filter[title]=Call&filter[notable_type]=company&filter[notable_id]=${companyId}&filter[created_after]=2026-01-01&filter[created_before]=2026-08-18&sort=title,-updated_at&include=creator,companiesCount`,
                ),
            ),
        ).toEqual({
            page: 2,
            perPage: 25,
            filters: {
                title: "Call",
                notableType: "company",
                notableId: companyId,
                createdAfter: "2026-01-01",
                createdBefore: "2026-08-18",
            },
            sorts: [
                { field: "title", direction: "asc" },
                { field: "updated_at", direction: "desc" },
            ],
            includes: ["creator", "companiesCount"],
        });
        expect(
            parseNoteListQuery(new URL("https://crm.example.test/api/v1/notes"))
                .sorts,
        ).toEqual([{ field: "created_at", direction: "desc" }]);
    });

    it.each([
        "filter[team_id]=secret",
        "filter[notable_type]=task",
        "filter[notable_id]=not-a-ulid",
        "filter[created_after]=2026-02-30",
        "sort=team_id",
        "include=secret",
        "cursor=true",
    ])("rejects unsupported query semantics: %s", async (query) => {
        const response = await handleNotesCollectionRequest(
            apiRequest(`/api/v1/notes?${query}`),
            dependencies(new InMemoryNotesRepository()),
        );

        expect(response.status).toBe(400);
    });

    it("filters by notable type/id and returns stable Laravel pagination metadata", async () => {
        const secondNoteId = ulid(50);
        const repository = new InMemoryNotesRepository([
            note(),
            note({ id: secondNoteId, title: "Follow-up" }),
            note({ id: otherNoteId, teamId: otherTeamId }),
        ]);
        repository.relationships.set(noteId, { company: [companyId] });
        repository.relationships.set(secondNoteId, { people: [personId] });
        const api = dependencies(repository);
        const filtered = await handleNotesCollectionRequest(
            apiRequest(
                `/api/v1/notes?filter[notable_type]=company&filter[notable_id]=${companyId}`,
            ),
            api,
        );
        const secondPage = await handleNotesCollectionRequest(
            apiRequest("/api/v1/notes?per_page=1&page=2&sort=title"),
            api,
        );
        const invalid = await handleNotesCollectionRequest(
            apiRequest("/api/v1/notes?per_page=101"),
            api,
        );
        const filteredDocument = (await filtered.json()) as {
            data: readonly { id: string }[];
        };
        const pageDocument = (await secondPage.json()) as {
            data: readonly unknown[];
            meta: Record<string, unknown>;
        };

        expect(filteredDocument.data.map(({ id }) => id)).toEqual([noteId]);
        expect(pageDocument.data).toHaveLength(1);
        expect(pageDocument.meta).toMatchObject({
            current_page: 2,
            per_page: 1,
            total: 2,
            from: 2,
            to: 2,
        });
        expect(invalid.status).toBe(422);
        await expect(invalid.json()).resolves.toMatchObject({
            errors: { per_page: [expect.stringContaining("100")] },
        });
    });
});
