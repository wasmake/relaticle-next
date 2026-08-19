import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => {
    const unsafe = vi.fn();
    const begin = vi.fn(async (callback: (transaction: { unsafe: typeof unsafe }) => Promise<unknown>) => callback({ unsafe }));
    return { unsafe, begin };
});

vi.mock("@/server/db/client", () => ({ getSqlClient: () => database }));

import { createAdminRecord, getAdminResource, updateAdminRecord } from "@/server/sysadmin/resources";

describe("blog administration writes", () => {
    beforeEach(() => { database.unsafe.mockReset(); database.begin.mockClear(); });

    it("creates the post and its taxonomy metadata in one transaction", async () => {
        database.unsafe
            .mockResolvedValueOnce([{ id: 7, title: "Post", slug: "post" }])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([]);
        const resource = getAdminResource("blog-posts")!;
        await createAdminRecord(resource, { title: "Post", slug: "post", content: "Body", tag_ids: "1,2" });
        expect(database.begin).toHaveBeenCalledOnce();
        expect(database.unsafe.mock.calls.some(([query]) => String(query).includes("blog_post_tag"))).toBe(true);
    });

    it("updates post metadata through the same transaction client", async () => {
        database.unsafe
            .mockResolvedValueOnce([{ id: 7 }])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ id: 7, title: "Post", slug: "post" }]);
        const resource = getAdminResource("blog-posts")!;
        await updateAdminRecord(resource, "7", { seo_title: "Search title" });
        expect(database.begin).toHaveBeenCalledOnce();
        expect(database.unsafe.mock.calls.some(([query]) => String(query).includes("insert into seo"))).toBe(true);
    });
});
