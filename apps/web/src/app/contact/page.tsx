import type { Metadata } from "next";
import Link from "next/link";

import { MarketingShell } from "@/app/_components/marketing-shell";

export const metadata: Metadata = { title: "Contact Us", description: "Contact Relaticle about deployments, integrations, partnerships, or support.", alternates: { canonical: "/contact" } };

const Page = async ({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) => {
    const query = await searchParams;
    const sent = query.sent === "1";
    const error = typeof query.error === "string";
    return <MarketingShell><section className="contact-layout"><div><p className="eyebrow">Contact</p><h1>Get in touch.</h1><p className="article-lede">Questions about deployments, integrations, or partnerships? Tell us what you are working on.</p><div className="contact-links"><Link href="/help">Help centre</Link><Link href="/developers">Developer docs</Link><a href="https://github.com/relaticle/relaticle" rel="noreferrer">GitHub repository</a></div></div><div className="contact-card">
        {sent ? <div role="status"><h2>Message sent</h2><p>Thanks for reaching out. We’ll get back to you soon.</p></div> : <form method="post" action="/contact">
            {error ? <p className="form-error" role="alert">Check each field and try again. Messages must be between 20 and 5,000 characters.</p> : null}
            <div className="honeypot" aria-hidden="true"><label htmlFor="website">Website</label><input id="website" name="website" tabIndex={-1} autoComplete="off" /></div>
            <label htmlFor="name">Name</label><input id="name" name="name" required maxLength={255} autoComplete="name" />
            <label htmlFor="email">Work email</label><input id="email" name="email" type="email" required maxLength={255} autoComplete="email" />
            <label htmlFor="company">Company</label><input id="company" name="company" maxLength={255} autoComplete="organization" />
            <label htmlFor="message">How can we help?</label><textarea id="message" name="message" required minLength={20} maxLength={5000} rows={7} />
            <button type="submit">Send message</button>
        </form>}
    </div></section></MarketingShell>;
};
export default Page;
