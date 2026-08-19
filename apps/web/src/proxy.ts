import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const proxy = (request: NextRequest) => {
    if (request.method === "POST") return NextResponse.rewrite(new URL("/contact/submit", request.url));
    return NextResponse.next();
};

export const config = { matcher: ["/contact"] };
