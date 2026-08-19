import { Resend } from "resend";

export type ContactMessage = Readonly<{ name: string; email: string; company?: string; message: string }>;

export interface ContactMailDelivery { send(message: ContactMessage): Promise<void> }
export interface ContactRateLimiter { consume(key: string): boolean }

export class FixedWindowContactRateLimiter implements ContactRateLimiter {
    private readonly attempts = new Map<string, { count: number; resetAt: number }>();
    public constructor(private readonly limit = 5, private readonly windowMs = 60_000, private readonly now = Date.now) {}
    public consume(key: string): boolean {
        const current = this.attempts.get(key);
        const timestamp = this.now();
        if (current === undefined || current.resetAt <= timestamp) {
            this.attempts.set(key, { count: 1, resetAt: timestamp + this.windowMs });
            return true;
        }
        if (current.count >= this.limit) return false;
        current.count += 1;
        return true;
    }
}

const defaultMailDelivery: ContactMailDelivery = {
    async send(message) {
        const apiKey = process.env.RESEND_API_KEY;
        const recipient = process.env.CONTACT_EMAIL;
        if (apiKey === undefined || recipient === undefined) {
            if (process.env.NODE_ENV === "production") throw new Error("Contact email delivery is not configured.");
            return;
        }
        const result = await new Resend(apiKey).emails.send({
            from: process.env.MAIL_FROM_ADDRESS ?? "Relaticle <noreply@relaticle.com>",
            to: recipient,
            replyTo: message.email,
            subject: `Contact request from ${message.name}`,
            text: [`Name: ${message.name}`, `Email: ${message.email}`, `Company: ${message.company ?? "Not provided"}`, "", message.message].join("\n"),
        });
        if (result.error !== null) throw new Error(`Contact email failed: ${result.error.message}`);
    },
};

const defaultRateLimiter = new FixedWindowContactRateLimiter();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const textField = (form: FormData, key: string): string => {
    const value = form.get(key);
    return typeof value === "string" ? value.trim() : "";
};
const redirect = (request: Request, query: string) => Response.redirect(new URL(`/contact?${query}`, request.url), 303);

export const handleContactPost = async (request: Request, dependencies: Readonly<{
    mail?: ContactMailDelivery;
    rateLimiter?: ContactRateLimiter;
}> = {}): Promise<Response> => {
    const origin = request.headers.get("origin");
    const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    let originMatchesHost = false;
    try { originMatchesHost = origin !== null && forwardedHost !== null && new URL(origin).host === forwardedHost; } catch { originMatchesHost = false; }
    if (request.headers.get("sec-fetch-site") !== "same-origin" && !originMatchesHost && origin !== new URL(request.url).origin) return new Response("Invalid request origin.", { status: 403 });

    const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? "unknown";
    if (!(dependencies.rateLimiter ?? defaultRateLimiter).consume(client)) return new Response("Too many contact requests.", { status: 429, headers: { "retry-after": "60" } });

    let form: FormData;
    try { form = await parseBoundedFormData(request, 16 * 1024); } catch (error) { return error instanceof RequestBodyTooLargeError ? new Response("Request body is too large.", { status: 413 }) : redirect(request, "error=invalid"); }
    // Bots tend to populate this visually hidden field. Return success so the field does not become an oracle.
    if (textField(form, "website") !== "") return redirect(request, "sent=1");

    const name = textField(form, "name");
    const email = textField(form, "email");
    const company = textField(form, "company");
    const message = textField(form, "message");
    if (name.length < 1 || name.length > 255 || !emailPattern.test(email) || email.length > 255 || company.length > 255 || message.length < 20 || message.length > 5000) return redirect(request, "error=validation");

    await (dependencies.mail ?? defaultMailDelivery).send({ name, email, ...(company === "" ? {} : { company }), message });
    return redirect(request, "sent=1");
};
import { parseBoundedFormData, RequestBodyTooLargeError } from "@/server/http/body";
