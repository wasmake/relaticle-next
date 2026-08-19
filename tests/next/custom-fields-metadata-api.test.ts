import { describe, expect, it } from "vitest";

import type { ApiAccessResult } from "@/server/api/access";
import { apiAccessFromHttpAuthResult, type ApiAccessResolver } from "@/server/api/http";
import type { HttpAuthResult } from "@/server/auth/http";
import type { CustomFieldMetadataRepository } from "@/server/custom-field-metadata/repository";
import { handleCustomFieldMetadataRequest } from "@/server/custom-field-metadata/handler";
import { parseCustomFieldMetadataQuery } from "@/server/custom-field-metadata/query";
import { CustomFieldMetadataService } from "@/server/custom-field-metadata/service";
import type {
    CustomFieldMetadataPage,
    CustomFieldMetadataQuery,
    CustomFieldMetadataRecord,
} from "@/server/custom-field-metadata/types";
import { createRequestContext } from "@/server/context/request-context";
import { ulidSchema, type Ulid } from "@/server/ids";

const ulid = (sequence: number): Ulid =>
    ulidSchema.parse(`01J${sequence.toString().padStart(23, "0")}`);
const userId = ulid(1);
const teamId = ulid(2);
const fieldId = ulid(3);
const optionId = ulid(4);

const authentication = (abilities: readonly ("read" | "create")[] | null = null): HttpAuthResult => ({
    ok: true,
    context: createRequestContext({
        requestId: "request-1",
        userId,
        teamId,
        credential:
            abilities === null
                ? { kind: "session", sessionId: "session-1" }
                : { kind: "personal_access_token", tokenId: "1", abilities },
    }),
    user: { id: userId, name: "Ada", email: "ada@example.test" },
    team: {
        id: teamId,
        name: "Analytical Engines",
        slug: "analytical-engines",
        personalTeam: false,
    },
});

class StaticAuth implements ApiAccessResolver {
    public constructor(private readonly result: HttpAuthResult) {}
    public async resolve(): Promise<ApiAccessResult> {
        return apiAccessFromHttpAuthResult(this.result);
    }
}

const field: CustomFieldMetadataRecord = {
    id: fieldId,
    sectionId: null,
    code: "industry",
    name: "Industry",
    type: "select",
    lookupType: null,
    entityType: "company",
    sortOrder: 2n,
    validationRules: { required: true },
    active: true,
    systemDefined: false,
    settings: { searchable: true },
    createdAt: new Date("2026-08-01T10:00:00.000Z"),
    updatedAt: null,
    options: [{ id: optionId, name: "Technology", sortOrder: 1n, settings: null }],
};

class RecordingRepository implements CustomFieldMetadataRepository {
    public calls: { teamId: Ulid; query: CustomFieldMetadataQuery }[] = [];
    public page: CustomFieldMetadataPage = {
        records: [field],
        page: 2,
        perPage: 1,
        total: 3,
    };

    public async list(requestedTeamId: Ulid, query: CustomFieldMetadataQuery) {
        this.calls.push({ teamId: requestedTeamId, query });
        return this.page;
    }
}

const dependencies = (auth: HttpAuthResult = authentication()) => {
    const repository = new RecordingRepository();
    return {
        repository,
        dependencies: {
            auth: new StaticAuth(auth),
            customFields: new CustomFieldMetadataService(repository),
        },
    };
};

describe("GET /api/v1/custom-fields", () => {
    it("parses Laravel pagination and strict supported filters", () => {
        expect(
            parseCustomFieldMetadataQuery(
                new URL(
                    "https://crm.example.test/api/v1/custom-fields?page=2&per_page=25&filter[entity_type]=people&filter[type]=text&filter[code]=role&filter[active]=0",
                ),
            ),
        ).toEqual({
            page: 2,
            perPage: 25,
            filters: { entityType: "people", type: "text", code: "role", active: false },
        });
        expect(
            parseCustomFieldMetadataQuery(
                new URL("https://crm.example.test/api/v1/custom-fields"),
            ).filters.active,
        ).toBe(true);
    });

    it.each([
        "per_page=101",
        "page=0",
        "filter[team_id]=secret",
        "filter[entity_type]=unknown",
        "filter[type]=unknown",
        "filter[active]=yes",
        "cursor=next",
    ])("rejects invalid query %s", async (query) => {
        const { dependencies: deps } = dependencies();
        const response = await handleCustomFieldMetadataRequest(
            new Request(`https://crm.example.test/api/v1/custom-fields?${query}`),
            deps,
        );
        expect([400, 422]).toContain(response.status);
    });

    it("scopes the repository to the authenticated team and returns paginator metadata", async () => {
        const { dependencies: deps, repository } = dependencies();
        const response = await handleCustomFieldMetadataRequest(
            new Request(
                "https://crm.example.test/api/v1/custom-fields?page=2&per_page=1&filter[entity_type]=company",
            ),
            deps,
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("application/vnd.api+json");
        expect(repository.calls).toEqual([
            {
                teamId,
                query: {
                    page: 2,
                    perPage: 1,
                    filters: { entityType: "company", active: true },
                },
            },
        ]);
        await expect(response.json()).resolves.toMatchObject({
            data: [
                {
                    id: fieldId,
                    type: "custom-fields",
                    attributes: {
                        code: "industry",
                        entity_type: "company",
                        sort_order: 2,
                        options: [{ id: optionId, name: "Technology", sort_order: 1 }],
                    },
                },
            ],
            links: { prev: expect.stringContaining("page=1"), next: expect.stringContaining("page=3") },
            meta: { current_page: 2, from: 2, last_page: 3, per_page: 1, to: 2, total: 3 },
        });
    });

    it("requires authentication and read ability before repository access", async () => {
        const denied: HttpAuthResult = {
            ok: false,
            failure: { reason: "credentials_missing", status: 401 },
        };
        const unauthorized = dependencies(denied);
        const forbidden = dependencies(authentication(["create"]));

        expect(
            (await handleCustomFieldMetadataRequest(
                new Request("https://crm.example.test/api/v1/custom-fields"),
                unauthorized.dependencies,
            )).status,
        ).toBe(401);
        expect(
            (await handleCustomFieldMetadataRequest(
                new Request("https://crm.example.test/api/v1/custom-fields"),
                forbidden.dependencies,
            )).status,
        ).toBe(403);
        expect(unauthorized.repository.calls).toEqual([]);
        expect(forbidden.repository.calls).toEqual([]);
    });
});
