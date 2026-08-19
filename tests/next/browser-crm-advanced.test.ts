import { describe, expect, it } from "vitest";

import { entityTypeForResource } from "@/app/app/[teamSlug]/_crm-data";
import { customFieldsFromFormData } from "@/server/custom-fields/browser-form";

describe("advanced browser CRM form handling", () => {
    it("maps browser resources to the persisted custom-field entity names", () => {
        expect(entityTypeForResource("companies")).toBe("company");
        expect(entityTypeForResource("people")).toBe("people");
        expect(entityTypeForResource("opportunities")).toBe("opportunity");
        expect(entityTypeForResource("tasks")).toBe("task");
        expect(entityTypeForResource("notes")).toBe("note");
    });

    it("preserves scalar, multi-choice, and boolean custom-field values", () => {
        const data = new FormData();
        data.set("custom_type.stage", "select");
        data.set("custom_field.stage", "01J00000000000000000000001");
        data.set("custom_type.regions", "multi-select");
        data.append("custom_field.regions", "north");
        data.append("custom_field.regions", "west");
        data.set("custom_type.qualified", "toggle");
        data.set("custom_field.qualified", "true");
        data.set("custom_type.contacts", "email");
        data.set("custom_field.contacts", "ada@example.test\ngrace@example.test");

        expect(customFieldsFromFormData(data)).toEqual({
            stage: "01J00000000000000000000001",
            regions: ["north", "west"],
            qualified: true,
            contacts: ["ada@example.test", "grace@example.test"],
        });
    });

    it("treats an unchecked boolean marker as false", () => {
        const data = new FormData();
        data.set("custom_type.completed", "checkbox");
        data.set("custom_field.completed", "false");
        expect(customFieldsFromFormData(data)).toEqual({ completed: false });
    });

    it("preserves an uploaded media UUID", () => {
        const data = new FormData();
        data.set("custom_type.contract", "file-upload");
        data.set("custom_field.contract", "123e4567-e89b-42d3-a456-426614174000");
        expect(customFieldsFromFormData(data)).toEqual({ contract: "123e4567-e89b-42d3-a456-426614174000" });
    });
});
