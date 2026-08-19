export const GET = (request: Request) => Response.redirect(new URL("/app/register", request.url), 302);
