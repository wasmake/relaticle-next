import { NextResponse } from "next/server";

import { rejectCrossOrigin, textFormValue } from "@/server/auth/browser/request";
import { requireManagedBillingWorkspace } from "@/server/billing/actions";
import { getBillingConfiguration } from "@/server/billing/configuration";

export const POST = async (request: Request): Promise<Response> => {
    const rejected = rejectCrossOrigin(request);
    if (rejected !== undefined) return rejected;
    const teamSlug = textFormValue(await request.formData(), "team_slug");
    const managed = await requireManagedBillingWorkspace(teamSlug);
    if ("response" in managed) return managed.response;

    let started = false;
    try {
        started = await managed.repository.startTrial(managed.workspace.id, getBillingConfiguration().trialDays);
    } catch {
        return NextResponse.redirect(new URL(`/app/${encodeURIComponent(teamSlug)}/billing?error=trial`, request.url), 303);
    }
    const result = started ? "started" : "used";
    return NextResponse.redirect(new URL(`/app/${encodeURIComponent(teamSlug)}/billing?trial=${result}`, request.url), 303);
};
