import { NextResponse } from "next/server";

import { buildReadinessReport } from "@/server/health/readiness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = async (): Promise<NextResponse> => {
    const report = await buildReadinessReport();

    return NextResponse.json(report, {
        status: report.status === "ready" ? 200 : 503,
        headers: {
            "cache-control": "no-store",
        },
    });
};
