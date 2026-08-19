import { describe, expect, it } from "vitest";

import { hashLaravelPassword, verifyLaravelPassword } from "@/server/auth/compatibility/password";
import { formValue, hasSameOrigin, rejectCrossOrigin, textFormValue } from "@/server/auth/browser/request";
import { workspaceSlug } from "@/server/workspaces/service";

describe("browser account request security", () => {
    it("accepts only an exact, parseable request origin", () => {
        expect(hasSameOrigin(new Request("https://crm.example.test/auth/profile", { method: "POST", headers: { origin: "https://crm.example.test" } }))).toBe(true);
        expect(hasSameOrigin(new Request("https://crm.example.test/auth/profile", { method: "POST", headers: { origin: "https://attacker.example" } }))).toBe(false);
        expect(hasSameOrigin(new Request("https://crm.example.test/auth/profile", { method: "POST", headers: { origin: "not a URL" } }))).toBe(false);
        expect(rejectCrossOrigin(new Request("https://crm.example.test/auth/profile", { method: "POST" }))?.status).toBe(403);
    });

    it("normalizes text fields without changing password bytes", () => {
        const form = new FormData();
        form.set("name", "  Ada Lovelace  ");
        form.set("password", " leading and trailing ");
        expect(textFormValue(form, "name")).toBe("Ada Lovelace");
        expect(formValue(form, "password")).toBe(" leading and trailing ");
    });
});

describe("browser account compatibility", () => {
    it("creates passwords accepted by the Laravel-compatible verifier", async () => {
        const password = "correct horse battery staple";
        const stored = await hashLaravelPassword(password);
        expect(stored).toMatch(/^\$2b\$12\$/u);
        await expect(verifyLaravelPassword(password, stored)).resolves.toBe(true);
        await expect(verifyLaravelPassword("wrong password", stored)).resolves.toBe(false);
    });

    it("creates stable URL-safe workspace slugs", () => {
        expect(workspaceSlug("  Émilie's Research & Sales  ")).toBe("emilie-s-research-sales");
        expect(workspaceSlug("***")).toBe("");
    });
});
