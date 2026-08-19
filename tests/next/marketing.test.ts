import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { JsonLd } from "@/app/_components/marketing-shell";
import sitemap from "@/app/sitemap";
import { FixedWindowContactRateLimiter, handleContactPost, type ContactMailDelivery } from "@/server/marketing/contact";
import { alternativeSlugs, comparisonSlugs, publicRoutes } from "@/server/marketing/content";
import { legacyDocumentationTarget } from "@/server/marketing/redirects";

const contactRequest = (fields: Record<string, string>, headers: Record<string, string> = {}) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return new Request("https://crm.example.test/contact", { method: "POST", body: form, headers: { origin: "https://crm.example.test", ...headers } });
};
const valid = { name: "Jane Doe", email: "jane@example.com", company: "Acme", message: "We would like to discuss a larger deployment." };

describe("public marketing surfaces", () => {
    it("declares every historical comparison and alternative route", () => {
        expect(comparisonSlugs).toEqual(["twenty", "espocrm"]);
        expect(alternativeSlugs).toEqual(["attio", "hubspot"]);
        expect(publicRoutes).toContain("/terms-of-service");
        expect(publicRoutes).toContain("/privacy-policy");
        expect(sitemap().map((entry) => new URL(entry.url).pathname)).toEqual(expect.arrayContaining([...publicRoutes]));
        expect(legacyDocumentationTarget(["import"])).toBe("/help/import");
        expect(legacyDocumentationTarget(["unknown"])).toBe("/developers");
    });

    it("keeps hostile JSON-LD text inside one escaped script", () => {
        const html = renderToStaticMarkup(JsonLd({ data: { name: "</script><script>bad()</script>" } }));
        expect(html.match(/<script/gu)).toHaveLength(1);
        expect(html).toContain("\\u003c/script>");
    });
});

describe("contact form", () => {
    it("delivers a valid same-origin submission through the injected adapter", async () => {
        const send = vi.fn<ContactMailDelivery["send"]>();
        const response = await handleContactPost(contactRequest(valid), { mail: { send }, rateLimiter: { consume: () => true } });
        expect(response.status).toBe(303);
        expect(response.headers.get("location")).toBe("https://crm.example.test/contact?sent=1");
        expect(send).toHaveBeenCalledWith(valid);
    });

    it("rejects cross-origin requests before delivery", async () => {
        const send = vi.fn<ContactMailDelivery["send"]>();
        const response = await handleContactPost(contactRequest(valid, { origin: "https://attacker.example" }), { mail: { send } });
        expect(response.status).toBe(403);
        expect(send).not.toHaveBeenCalled();
    });

    it("silently accepts a populated honeypot without delivery", async () => {
        const send = vi.fn<ContactMailDelivery["send"]>();
        const response = await handleContactPost(contactRequest({ ...valid, website: "spam.example" }), { mail: { send }, rateLimiter: { consume: () => true } });
        expect(response.status).toBe(303);
        expect(response.headers.get("location")).toContain("sent=1");
        expect(send).not.toHaveBeenCalled();
    });

    it("validates fields and limits the sixth request in a minute", async () => {
        let now = 1_000;
        const limiter = new FixedWindowContactRateLimiter(5, 60_000, () => now);
        const dependency = { mail: { send: vi.fn<ContactMailDelivery["send"]>() }, rateLimiter: limiter };
        const invalid = await handleContactPost(contactRequest({ ...valid, message: "short" }, { "x-forwarded-for": "192.0.2.1" }), dependency);
        expect(invalid.headers.get("location")).toContain("error=validation");
        for (let index = 0; index < 4; index += 1) await handleContactPost(contactRequest(valid, { "x-forwarded-for": "192.0.2.1" }), dependency);
        expect((await handleContactPost(contactRequest(valid, { "x-forwarded-for": "192.0.2.1" }), dependency)).status).toBe(429);
        now += 60_000;
        expect((await handleContactPost(contactRequest(valid, { "x-forwarded-for": "192.0.2.1" }), dependency)).status).toBe(303);
    });
});
