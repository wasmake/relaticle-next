import { NextResponse } from "next/server";

import { accountMailDelivery } from "@/server/accounts/delivery";
import { scheduleAccountDeletion } from "@/server/accounts/service";
import { requireBrowserUser } from "@/server/auth/browser/context";
import { rejectCrossOrigin, textFormValue } from "@/server/auth/browser/request";
import { createHttpAuthConfiguration } from "@/server/auth/http/configuration";
import { createSignedToken, readSignedToken } from "@/server/auth/browser/signed-token";
import { ulidSchema } from "@/server/ids";

export const GET = async (request: Request): Promise<Response> => {
    const value = readSignedToken(new URL(request.url).searchParams.get("token") ?? "");
    const userId = ulidSchema.safeParse(value?.userId);
    if (!userId.success || value?.intent !== "cancel-deletion") return NextResponse.redirect(new URL("/app/login?error=invalid", request.url), 303);
    const result = await scheduleAccountDeletion(userId.data, true);
    await accountMailDelivery.send({ kind: "deletion-cancelled", recipient: result.email });
    return NextResponse.redirect(new URL("/app/login?deletion=cancelled", request.url), 303);
};

export const POST = async (request: Request): Promise<Response> => {
    const rejected = rejectCrossOrigin(request);
    if (rejected) return rejected;
    const identity = await requireBrowserUser();
    const cancel = textFormValue(await request.formData(), "intent") === "cancel";
    const result = await scheduleAccountDeletion(identity.userId, cancel);
    const cancellation = cancel ? undefined : createSignedToken({ userId: result.id, intent: "cancel-deletion", expiresAt: result.scheduledAt?.getTime() });
    await accountMailDelivery.send({ kind: cancel ? "deletion-cancelled" : "deletion-scheduled", recipient: result.email, url: cancellation ? new URL(`/auth/account-deletion?token=${encodeURIComponent(cancellation)}`, request.url).toString() : undefined });
    const response = NextResponse.redirect(new URL(cancel ? "/app/settings/profile?deletion=cancelled" : "/app/login?deletion=scheduled", request.url), 303);
    if (!cancel) response.cookies.set(createHttpAuthConfiguration().sessionCookieName, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
    return response;
};
