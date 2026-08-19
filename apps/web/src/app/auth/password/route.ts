import { NextResponse } from "next/server";
import { z } from "zod";

import { updatePassword } from "@/server/accounts/service";
import { requireBrowserUser } from "@/server/auth/browser/context";
import { formValue, rejectCrossOrigin } from "@/server/auth/browser/request";

export const POST = async (request: Request): Promise<Response> => {
    const rejected = rejectCrossOrigin(request);
    if (rejected !== undefined) return rejected;
    const identity = await requireBrowserUser();
    const form = await request.formData();
    const current = formValue(form, "current_password");
    const password = z.string().min(12).max(1024).safeParse(formValue(form, "password"));
    if (!password.success || password.data !== formValue(form, "password_confirmation") || !(await updatePassword(identity.userId, current, password.data))) return NextResponse.redirect(new URL("/app/settings/security?error=password", request.url), 303);
    const response = NextResponse.redirect(new URL("/app/login?password=updated", request.url), 303);
    return response;
};
