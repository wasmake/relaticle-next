export const GET = (request: Request) => Response.redirect(new URL("/app", request.url), 302);
