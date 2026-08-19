import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { accountMailDelivery } from "@/server/accounts/delivery";
import { createEmailVerificationToken } from "@/server/accounts/verification";
import { rejectCrossOrigin, textFormValue } from "@/server/auth/browser/request";
import { getDatabase } from "@/server/db/client";
import { users } from "@/server/db/schema";

export const POST = async (request: Request): Promise<Response> => {
    const rejected = rejectCrossOrigin(request);
    if (rejected !== undefined) return rejected;
    const email = z.email().max(255).safeParse(textFormValue(await request.formData(), "email"));
    if (email.success) {
        const normalized = email.data.toLowerCase();
        const [user] = await getDatabase().select({ id: users.id, verifiedAt: users.emailVerifiedAt }).from(users).where(eq(users.email, normalized)).limit(1);
        if (user !== undefined && user.verifiedAt === null) {
            const token = createEmailVerificationToken(user.id, normalized);
            if (token !== undefined) await accountMailDelivery.send({ kind: "email-verification", recipient: normalized, url: new URL(`/auth/email/verify?token=${encodeURIComponent(token)}`, request.url).toString() });
        }
    }
    return NextResponse.redirect(new URL("/app/verify-email?sent=1", request.url), 303);
};
