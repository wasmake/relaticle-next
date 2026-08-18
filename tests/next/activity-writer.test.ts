import { describe, expect, it } from "vitest";

import { ActivityWriter } from "@/server/activity/writer";
import type { DatabaseTransaction } from "@/server/custom-fields/persist";
import type {
    CustomFieldValueMutation,
    PreparedCustomFieldWrite,
} from "@/server/custom-fields/types";
import {
    activityLog,
    customFieldOptions,
    customFields,
    customFieldValues,
} from "@/server/db/schema";
import type { Ulid } from "@/server/ids";

const teamId = "01J00000000000000000000001" as Ulid;
const userId = "01J00000000000000000000002" as Ulid;
const companyId = "01J00000000000000000000003" as Ulid;
const fieldId = "01J00000000000000000000004" as Ulid;
const valueId = "01J00000000000000000000005" as Ulid;
const now = new Date("2026-08-18T12:00:00.000Z");
const batchUuid = "11111111-1111-4111-8111-111111111111";

const mutation = (
    textValue: string | null,
): CustomFieldValueMutation => ({
    id: valueId,
    teamId,
    entityType: "company",
    entityId: companyId,
    customFieldId: fieldId,
    stringValue: null,
    textValue,
    booleanValue: null,
    integerValue: null,
    floatValue: null,
    dateValue: null,
    datetimeValue: null,
    jsonValue: null,
});

const prepared = (value: CustomFieldValueMutation): PreparedCustomFieldWrite => ({
    teamId,
    entityType: "company",
    entityId: companyId,
    mutations: [value],
    optionPromotions: [],
});

class FakeSelectQuery implements PromiseLike<readonly unknown[]> {
    public constructor(private readonly rows: readonly unknown[]) {}

    public where(): this {
        return this;
    }

    public for(): Promise<readonly unknown[]> {
        return Promise.resolve(this.rows);
    }

    public then<TResult1 = readonly unknown[], TResult2 = never>(
        onfulfilled?:
            | ((value: readonly unknown[]) => TResult1 | PromiseLike<TResult1>)
            | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
        return Promise.resolve(this.rows).then(onfulfilled, onrejected);
    }
}

class FakeActivityTransaction {
    public readonly inserts: unknown[] = [];

    public constructor(private readonly existingText: string | null) {}

    public select(): Readonly<{
        from: (table: unknown) => FakeSelectQuery;
    }> {
        return {
            from: (table) => {
                if (table === customFields) {
                    return new FakeSelectQuery([
                        {
                            id: fieldId,
                            code: "lead_source",
                            name: "Lead source",
                            type: "text",
                            settings: null,
                        },
                    ]);
                }

                if (table === customFieldOptions) {
                    return new FakeSelectQuery([]);
                }

                if (table === customFieldValues && this.existingText !== null) {
                    return new FakeSelectQuery([
                        {
                            ...mutation(this.existingText),
                            tenantId: teamId,
                        },
                    ]);
                }

                return new FakeSelectQuery([]);
            },
        };
    }

    public insert(table: unknown): Readonly<{
        values: (value: unknown) => Promise<void>;
    }> {
        if (table !== activityLog) {
            throw new Error("Unexpected table insert in activity test.");
        }

        return {
            values: async (value) => {
                this.inserts.push(value);
            },
        };
    }
}

const transaction = (existingText: string | null) => {
    const fake = new FakeActivityTransaction(existingText);

    return {
        fake,
        value: fake as unknown as DatabaseTransaction,
    };
};

describe("CRM activity transaction writer", () => {
    it("groups native and custom-field changes with Laravel-compatible payloads", async () => {
        const { fake, value } = transaction("Referral");
        const writer = new ActivityWriter(true, undefined, () => batchUuid);

        await writer.writeNative(value, {
            teamId,
            subjectType: "company",
            subjectId: companyId,
            causerId: userId,
            event: "updated",
            attributes: { name: "Analytical Engines" },
            old: { name: "Difference Engines" },
            batchUuid: writer.batchUuid(),
            occurredAt: now,
        });
        await writer.writeCustomFields(
            value,
            prepared(mutation("Partner")),
            userId,
            batchUuid,
            now,
        );

        expect(fake.inserts).toEqual([
            expect.objectContaining({
                teamId,
                logName: "crm",
                description: "updated",
                subjectType: "company",
                subjectId: companyId,
                event: "updated",
                causerType: "user",
                causerId: userId,
                attributeChanges: {
                    attributes: { name: "Analytical Engines" },
                    old: { name: "Difference Engines" },
                },
                batchUuid,
            }),
            expect.objectContaining({
                logName: "crm",
                description: "custom_field_changes",
                event: "custom_field_changes",
                batchUuid,
                properties: {
                    custom_field_changes: [
                        {
                            code: "lead_source",
                            label: "Lead source",
                            type: "text",
                            old: { value: "Referral", label: "Referral" },
                            new: { value: "Partner", label: "Partner" },
                        },
                    ],
                },
            }),
        ]);
    });

    it("logs clears but suppresses unchanged and empty-to-empty custom fields", async () => {
        const clearing = transaction("Referral");
        const unchanged = transaction("Referral");
        const empty = transaction(null);
        const writer = new ActivityWriter(true, undefined, () => batchUuid);

        await writer.writeCustomFields(
            clearing.value,
            prepared(mutation(null)),
            userId,
            batchUuid,
            now,
        );
        await writer.writeCustomFields(
            unchanged.value,
            prepared(mutation("Referral")),
            userId,
            batchUuid,
            now,
        );
        await writer.writeCustomFields(
            empty.value,
            prepared(mutation(null)),
            userId,
            batchUuid,
            now,
        );

        expect(clearing.fake.inserts).toHaveLength(1);
        expect(clearing.fake.inserts[0]).toMatchObject({
            properties: {
                custom_field_changes: [
                    {
                        old: { value: "Referral", label: "Referral" },
                        new: { value: null, label: "—" },
                    },
                ],
            },
        });
        expect(unchanged.fake.inserts).toEqual([]);
        expect(empty.fake.inserts).toEqual([]);
    });

    it("suppresses empty native updates and all activity when logging is disabled", async () => {
        const enabled = transaction(null);
        const disabled = transaction(null);
        const writer = new ActivityWriter(true, undefined, () => batchUuid);

        await writer.writeNative(enabled.value, {
            teamId,
            subjectType: "company",
            subjectId: companyId,
            causerId: userId,
            event: "updated",
            batchUuid,
            occurredAt: now,
        });
        await new ActivityWriter(false).writeNative(disabled.value, {
            teamId,
            subjectType: "company",
            subjectId: companyId,
            causerId: userId,
            event: "created",
            attributes: { name: "Blocked" },
            batchUuid,
            occurredAt: now,
        });

        expect(enabled.fake.inserts).toEqual([]);
        expect(disabled.fake.inserts).toEqual([]);
    });
});
