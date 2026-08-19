import Link from "next/link";

const PasswordResetRequestPage = async ({ searchParams }: { searchParams: Promise<{ sent?: string }> }) => {
    const { sent } = await searchParams;
    return <main className="auth-page"><section className="auth-intro"><Link href="/" className="wordmark">Relaticle</Link><p className="eyebrow">Account recovery</p><h1>Find your way back to the work.</h1></section><section className="auth-card"><h2>Reset password</h2>{sent === "1" ? <p role="status">If that account exists, a reset link has been sent.</p> : null}<form method="post" action="/auth/password-reset/request"><label htmlFor="email">Email address</label><input id="email" name="email" type="email" autoComplete="email" required /><button type="submit">Send reset link</button></form><div className="auth-links"><Link href="/app/login">Return to sign in</Link></div></section></main>;
};
export default PasswordResetRequestPage;
