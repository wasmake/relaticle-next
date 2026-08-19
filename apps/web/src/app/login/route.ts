export const GET = (request: Request) => Response.redirect(new URL("/app/login", request.url), 302);
