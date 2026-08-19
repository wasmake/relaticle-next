import { describe, expect, it } from "vitest";

import { mergeActivityBatches } from "@/server/activity/reader";
import { assertCustomFieldTypeChange, belongsToCustomFieldReorderGroup, CustomFieldInputError } from "@/server/custom-field-metadata/browser";
import { chatRecordPath } from "@/server/chat/tools";

describe("tenant UI review fixes", () => {
    it("rejects unsafe custom-field type changes and groups reorder neighbors", () => {
        expect(() => assertCustomFieldTypeChange("text", "number", 1)).toThrow(CustomFieldInputError);
        expect(() => assertCustomFieldTypeChange("text", "number", 0)).not.toThrow();
        expect(belongsToCustomFieldReorderGroup("field", { entityType: "company", customFieldSectionId: "a" }, { entityType: "company", customFieldSectionId: "a" })).toBe(true);
        expect(belongsToCustomFieldReorderGroup("field", { entityType: "company", customFieldSectionId: "a" }, { entityType: "company", customFieldSectionId: "b" })).toBe(false);
        expect(belongsToCustomFieldReorderGroup("option", { customFieldId: "field-a" }, { customFieldId: "field-b" })).toBe(false);
    });

    it("merges native and custom-field activity from one batch and retains details", () => {
        const activity = mergeActivityBatches([
            { id: "2", batchUuid: "batch", event: "custom_field_changes", description: "custom_field_changes", actor: "Ada", changes: {}, properties: { custom_field_changes: [{ code: "segment", label: "Segment", old: { label: "Lead" }, new: { label: "Customer" } }] }, createdAt: "2026-08-19T12:00:00.000Z" },
            { id: "1", batchUuid: "batch", event: "updated", description: "updated", actor: "Ada", changes: { attributes: { name: "Acme" }, old: { name: "Old Acme" } }, properties: {}, createdAt: "2026-08-19T12:00:00.000Z" },
        ]);
        expect(activity).toHaveLength(1);
        expect(activity[0]).toMatchObject({ event: "updated", details: ["Segment: Lead -> Customer", "name: Old Acme -> Acme"] });
    });

    it("builds workspace-aware chat links with CRM route plurals", () => {
        expect(chatRecordPath("acme", "company", "01J1")).toBe("/app/acme/companies/01J1");
        expect(chatRecordPath("acme", "opportunity", "01J2")).toBe("/app/acme/opportunities/01J2");
        expect(chatRecordPath("acme", "task", "01J3")).toBe("/app/acme/tasks/01J3");
        expect(chatRecordPath("acme", "note", "01J4")).toBe("/app/acme/notes/01J4");
    });
});
