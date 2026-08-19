import { createPreviewToken } from "@/server/blog/preview";
import { requireSystemAdministratorApi } from "@/server/sysadmin/http";

export const GET = async (request: Request): Promise<Response> => {
    const unauthorized = await requireSystemAdministratorApi(); if (unauthorized !== undefined) return unauthorized;
    const slug = new URL(request.url).searchParams.get("slug"); if (slug === null || slug === "") return Response.json({ message: "A slug is required." }, { status: 422 });
    const expires = Math.floor(Date.now() / 1000) + 60 * 30;
    const token = createPreviewToken(slug, expires);
    return Response.json({ url: `/blog/preview/${encodeURIComponent(slug)}?token=${encodeURIComponent(token)}`, expires });
};
