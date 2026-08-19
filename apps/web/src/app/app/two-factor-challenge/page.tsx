import Link from "next/link";
import Script from "next/script";

import { getEnvironment } from "@/server/env";

const TwoFactorChallengePage = async ({ searchParams }: { searchParams: Promise<{ error?: string }> }) => {
    const { error } = await searchParams;
    const environment = getEnvironment();
    return <main className="auth-page"><section className="auth-intro"><Link href="/" className="wordmark">Relaticle</Link><p className="eyebrow">Protected account</p><h1>One more proof that it is you.</h1><p>Use the current code from your authenticator, or one unused recovery code.</p></section><section className="auth-card"><p className="eyebrow">Two-factor authentication</p><h2>Security code</h2>{error ? <p className="form-error" role="alert">{error === "turnstile" ? "Please complete the security check." : error === "rate_limited" ? "Too many attempts. Try again in a minute." : "That code is invalid or has already been used."}</p> : null}<form method="post" action="/auth/two-factor/challenge"><label htmlFor="code">Authenticator or recovery code</label><input id="code" name="code" autoComplete="one-time-code" autoFocus required />{environment.TURNSTILE_SITE_KEY ? <div className="cf-turnstile" data-sitekey={environment.TURNSTILE_SITE_KEY} /> : null}<button type="submit">Verify and sign in</button></form><div className="auth-links"><Link href="/app/login">Return to sign in</Link></div>{environment.TURNSTILE_SITE_KEY ? <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" /> : null}</section></main>;
};
export default TwoFactorChallengePage;
