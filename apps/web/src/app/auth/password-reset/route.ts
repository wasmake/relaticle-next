import { NextResponse } from "next/server";
import { z } from "zod";

import { resetPassword } from "@/server/accounts/service";
import { formValue, rejectCrossOrigin, textFormValue } from "@/server/auth/browser/request";

const schema = z.object({ email: z.email().max(255), token: z.string().min(32).max(255), password: z.string().min(12).max(1024) });
export const POST = async (request: Request): Promise<Response> => {
    const rejected = rejectCrossOrigin(request);
    if (rejected !== undefined) return rejected;
    const form = await request.formData();
    const input = schema.safeParse({ email: textFormValue(form, "email"), token: textFormValue(form, "token"), password: formValue(form, "password") });
    if (!input.success || input.data.password !== formValue(form, "password_confirmation") || !(await resetPassword(input.data))) return NextResponse.redirect(new URL("/app/password-reset?error=invalid", request.url), 303);
    return NextResponse.redirect(new URL("/app/login?reset=1", request.url), 303);
};
