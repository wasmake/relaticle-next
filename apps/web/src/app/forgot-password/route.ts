export const GET = (request: Request) => Response.redirect(new URL("/app/password-reset/request", request.url), 302);
