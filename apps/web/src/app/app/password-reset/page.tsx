import Link from "next/link";

const PasswordResetPage = async ({ searchParams }: { searchParams: Promise<{ email?: string; token?: string; error?: string }> }) => {
    const values = await searchParams;
    return <main className="auth-page"><section className="auth-intro"><Link href="/" className="wordmark">Relaticle</Link><p className="eyebrow">Account recovery</p><h1>Choose a fresh key.</h1></section><section className="auth-card"><h2>New password</h2>{values.error === undefined ? null : <p className="form-error" role="alert">This reset link is invalid or expired.</p>}<form method="post" action="/auth/password-reset"><input type="hidden" name="token" value={values.token ?? ""} /><label htmlFor="email">Email address</label><input id="email" name="email" type="email" defaultValue={values.email ?? ""} required /><label htmlFor="password">New password</label><input id="password" name="password" type="password" minLength={12} required /><label htmlFor="password_confirmation">Confirm password</label><input id="password_confirmation" name="password_confirmation" type="password" minLength={12} required /><button type="submit">Reset password</button></form></section></main>;
};
export default PasswordResetPage;
