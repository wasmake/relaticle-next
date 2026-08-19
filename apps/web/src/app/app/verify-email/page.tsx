import Link from "next/link";

const VerifyEmailPage = async ({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) => {
    const values = await searchParams;
    return <main className="auth-page"><section className="auth-intro"><Link href="/" className="wordmark">Relaticle</Link><p className="eyebrow">One more step</p><h1>Verify where we can reach you.</h1></section><section className="auth-card"><h2>Check your inbox</h2>{values.sent === "1" ? <p role="status">If the address is awaiting verification, a fresh link has been sent.</p> : null}{values.error === "invalid" ? <p className="form-error" role="alert">That verification link is invalid or expired.</p> : null}<p>Verification links expire after 24 hours.</p><form method="post" action="/auth/email/request"><label htmlFor="email">Email address</label><input id="email" name="email" type="email" required /><button type="submit">Resend verification link</button></form><div className="auth-links"><Link href="/app/login">Return to sign in</Link></div></section></main>;
};
export default VerifyEmailPage;
