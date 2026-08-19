import { NextResponse } from "next/server";
import { z } from "zod";

import { accountMailDelivery } from "@/server/accounts/delivery";
import { requestPasswordReset } from "@/server/accounts/service";
import { applicationUrl } from "@/server/auth/application-url";
import { rejectCrossOrigin, textFormValue } from "@/server/auth/browser/request";

export const POST = async (request: Request): Promise<Response> => {
    const rejected = rejectCrossOrigin(request);
    if (rejected !== undefined) return rejected;
    const form = await request.formData();
    const email = z.email().max(255).safeParse(textFormValue(form, "email"));
    if (email.success) {
        const token = await requestPasswordReset(email.data);
        if (token !== undefined) {
            const resetUrl = applicationUrl("/app/password-reset");
            resetUrl.searchParams.set("email", email.data);
            resetUrl.searchParams.set("token", token);
            await accountMailDelivery.send({ kind: "password-reset", recipient: email.data, url: resetUrl.toString() });
        }
    }
    return NextResponse.redirect(new URL("/app/password-reset/request?sent=1", request.url), 303);
};
