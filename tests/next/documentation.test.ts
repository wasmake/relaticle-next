import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
    documentationCategories,
    documentationPages,
    findDocumentationPage,
    pagesInCategory,
} from "@/server/documentation/content";
import { buildLlmsText, buildSearchIndex } from "@/server/documentation/indexes";
import { Markdown } from "@/server/documentation/markdown";

describe("documentation content", () => {
    it("loads the ported developer and help manifests in navigation order", () => {
        expect(pagesInCategory("docs", "guides").map((page) => page.slug)).toEqual([
            "self-hosting",
            "mcp",
            "contributing",
        ]);
        expect(documentationCategories.filter((category) => category.area === "help")).toHaveLength(7);
        expect(documentationPages.filter((page) => page.area === "help")).toHaveLength(33);
        expect(findDocumentationPage("help/getting-started/create-your-first-company")?.related).toContain(
            "help/getting-started/add-your-first-person",
        );
    });

    it("renders Markdown as escaped React nodes and rejects unsafe URLs", () => {
        const html = renderToStaticMarkup(Markdown({
            source: "## Safe\n\n<script>alert(1)</script> [bad](javascript:alert(1)) ![bad](https://bad.test/a.png)",
        }));
        expect(html).toContain("id=\"safe\"");
        expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
        expect(html).not.toContain("javascript:");
        expect(html).not.toContain("<img");
    });

    it("builds section search records and an absolute agent index", () => {
        const index = buildSearchIndex();
        expect(index.v).toBe(2);
        expect(index.records).toContainEqual(expect.objectContaining({
            path: "docs/guides/self-hosting",
            section: "Quick Start",
            url: "/developers/self-hosting#quick-start",
        }));
        const llms = buildLlmsText("https://relaticle.test");
        expect(llms).toContain("[Self-Hosting Guide](https://relaticle.test/developers/self-hosting)");
        expect(llms).toContain("https://relaticle.test/help/getting-started/create-your-first-company");
    });
});
