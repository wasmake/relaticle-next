export const dynamic = "force-dynamic";

export const GET = (): Response =>
    new Response("OK", {
        status: 200,
        headers: {
            "cache-control": "no-store",
            "content-type": "text/plain; charset=utf-8",
        },
    });
