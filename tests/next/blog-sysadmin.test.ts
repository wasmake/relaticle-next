import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { Markdown, safeMarkdownUrl } from "@/components/blog/markdown";
import { createPreviewToken, verifyPreviewToken } from "@/server/blog/preview";
import { escapeXml, renderRss } from "@/server/blog/rss";
import { canDeleteSystemAdministratorRecord, canSystemAdministrator, rejectCrossOriginWrite } from "@/server/sysadmin/http";
import { adminResources, serializeAdminRecord } from "@/server/sysadmin/resources";
import { readBoundedText, RequestBodyTooLargeError } from "@/server/http/body";
import {
    createSystemAdministratorToken,
    isEligibleSystemAdministrator,
    verifySystemAdministratorToken,
} from "@/server/sysadmin/session";

const secret = "a-test-secret-that-is-long-enough";

describe("public blog safety", () => {
    it("accepts local and web links but rejects executable protocols", () => {
        expect(safeMarkdownUrl("/blog/example")).toBe("/blog/example");
        expect(safeMarkdownUrl("https://example.test/post")).toBe(
            "https://example.test/post",
        );
        expect(safeMarkdownUrl("javascript:alert(1)")).toBeUndefined();
        expect(safeMarkdownUrl("data:text/html,unsafe")).toBeUndefined();
    });

    it("renders Markdown as escaped React nodes without raw HTML or unsafe links", () => {
        const html = renderToStaticMarkup(createElement(
            Markdown,
            null,
            `# Heading\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert)`,
        ));

        expect(html).toContain("<h2>Heading</h2>");
        expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
        expect(html).not.toContain("href=");
    });

    it("binds preview signatures to their slug and expiry", () => {
        const now = Date.parse("2026-08-19T10:00:00Z");
        const token = createPreviewToken("private-post", now / 1000 + 60, secret);

        expect(verifyPreviewToken(token, "private-post", now, secret)).toBe(true);
        expect(verifyPreviewToken(token, "other-post", now, secret)).toBe(false);
        expect(verifyPreviewToken(token, "private-post", now + 61_000, secret)).toBe(false);
        expect(verifyPreviewToken(`${token}x`, "private-post", now, secret)).toBe(false);
    });

    it("escapes all XML-sensitive feed fields", () => {
        expect(escapeXml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&apos;");
        const xml = renderRss(
            [{
                id: "1",
                title: "A < B & C",
                slug: "safe-post",
                excerpt: 'A "summary"',
                featuredImage: null,
                publishedAt: new Date("2026-08-19T10:00:00Z"),
                authorName: null,
                category: null,
                tags: [],
            }],
            "https://example.test",
        );
        expect(xml).toContain("A &lt; B &amp; C");
        expect(xml).toContain("A &quot;summary&quot;");
    });
});

describe("system administration boundaries", () => {
    it("signs, expires, and rejects tampered administrator sessions", () => {
        const now = Date.parse("2026-08-19T10:00:00Z");
        const token = createSystemAdministratorToken(
            { id: "01KADMIN", name: "Ada", email: "ada@example.test", role: "owner" },
            now,
            secret,
        );
        expect(verifySystemAdministratorToken(token, now, secret)).toMatchObject({
            id: "01KADMIN",
            role: "owner",
        });
        expect(verifySystemAdministratorToken(`${token}x`, now, secret)).toBeUndefined();
        expect(
            verifySystemAdministratorToken(token, now + 8 * 60 * 60 * 1000 + 1, secret),
        ).toBeUndefined();
    });

    it("rejects cross-origin writes while permitting same-origin requests", () => {
        const foreign = new Request("https://crm.example.test/sysadmin/api/resources/users", {
            method: "POST",
            headers: { origin: "https://attacker.example" },
        });
        const local = new Request("https://crm.example.test/sysadmin/api/resources/users", {
            method: "PATCH",
            headers: { origin: "https://crm.example.test" },
        });
        expect(rejectCrossOriginWrite(foreign)?.status).toBe(419);
        expect(rejectCrossOriginWrite(local)).toBeUndefined();
        expect(rejectCrossOriginWrite(new Request(local.url, { method: "PATCH", headers: { "sec-fetch-site": "same-site" } }))?.status).toBe(419);
    });

    it("whitelists serialized fields and never returns authentication secrets", () => {
        const users = adminResources.find((resource) => resource.slug === "users")!;
        const administrators = adminResources.find((resource) => resource.slug === "system-administrators")!;
        expect(serializeAdminRecord(users, { id: "user", name: "Ada", email: "ada@example.test", password: "hash", two_factor_secret: "secret", two_factor_recovery_codes: "codes", remember_token: "token" })).toEqual({ id: "user", name: "Ada", email: "ada@example.test" });
        expect(serializeAdminRecord(administrators, { id: "admin", name: "Ada", email: "ada@example.test", role: "owner", password: "hash", remember_token: "token" })).toEqual({ id: "admin", name: "Ada", email: "ada@example.test", role: "owner" });
    });

    it("enforces owner, administrator, and read-only viewer policies", () => {
        const users = adminResources.find((resource) => resource.slug === "users")!;
        const administrators = adminResources.find((resource) => resource.slug === "system-administrators")!;
        expect(canSystemAdministrator({ role: "owner" }, "delete", administrators)).toBe(true);
        expect(canSystemAdministrator({ role: "admin" }, "write", users)).toBe(true);
        expect(canSystemAdministrator({ role: "admin" }, "read", administrators)).toBe(false);
        expect(canSystemAdministrator({ role: "viewer" }, "read", users)).toBe(true);
        expect(canSystemAdministrator({ role: "viewer" }, "write", users)).toBe(false);
        expect(canSystemAdministrator({ role: "unknown" }, "read", users)).toBe(false);
        expect(isEligibleSystemAdministrator({ role: "owner", emailVerifiedAt: new Date() })).toBe(true);
        expect(isEligibleSystemAdministrator({ role: "owner", emailVerifiedAt: null })).toBe(false);
        expect(isEligibleSystemAdministrator({ role: "unknown", emailVerifiedAt: new Date() })).toBe(false);
        expect(canDeleteSystemAdministratorRecord({ id: "self" }, administrators, "self")).toBe(false);
        expect(canDeleteSystemAdministratorRecord({ id: "self" }, administrators, "other")).toBe(true);
    });

    it("stops reading request bodies at the configured limit", async () => {
        await expect(readBoundedText(new Request("https://crm.example.test", { method: "POST", body: "12345" }), 4)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
    });

    it("exposes an explicit registry for every requested operational domain", () => {
        const slugs = adminResources.map((resource) => resource.slug);
        expect(slugs).toEqual(expect.arrayContaining([
            "users", "teams", "companies", "people", "opportunities", "tasks",
            "notes", "imports", "activity", "subscriptions", "ai-conversations",
            "ai-messages", "ai-feedback", "ai-credits", "ai-credit-transactions",
            "system-administrators", "blog-posts", "blog-categories", "blog-tags",
        ]));
        expect(new Set(slugs).size).toBe(slugs.length);
    });
});
