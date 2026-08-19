import { requireBrowserUser } from "@/server/auth/browser/context";
import { rejectCrossOrigin } from "@/server/auth/browser/request";
import { getNotificationCenter, markNotificationsRead, updateNotificationPreferences } from "@/server/notifications/service";

export const GET = async (): Promise<Response> => {
    const identity = await requireBrowserUser();
    return Response.json(await getNotificationCenter(identity.userId));
};

export const PATCH = async (request: Request): Promise<Response> => {
    const rejected = rejectCrossOrigin(request);
    if (rejected !== undefined) return rejected;
    const identity = await requireBrowserUser();
    const body = await request.json() as unknown;
    if (typeof body !== "object" || body === null || Array.isArray(body)) return Response.json({ message: "Invalid request." }, { status: 422 });
    const input = body as Record<string, unknown>;
    if (input.action === "preferences" && typeof input.email === "boolean" && typeof input.inApp === "boolean") await updateNotificationPreferences(identity.userId, { email: input.email, inApp: input.inApp });
    else if (input.action === "read" && (input.ids === undefined || (Array.isArray(input.ids) && input.ids.every((id) => typeof id === "string")))) await markNotificationsRead(identity.userId, input.ids as string[] | undefined);
    else return Response.json({ message: "Invalid request." }, { status: 422 });
    return Response.json({ data: await getNotificationCenter(identity.userId) });
};
