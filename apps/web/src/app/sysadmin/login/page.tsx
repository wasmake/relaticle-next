import { redirect } from "next/navigation";

import styles from "@/components/sysadmin/admin.module.css";
import { currentSystemAdministrator } from "@/server/sysadmin/session";

type Properties = Readonly<{ searchParams: Promise<{ error?: string }> }>;
const LoginPage = async ({ searchParams }: Properties) => {
    if ((await currentSystemAdministrator()) !== undefined) redirect("/sysadmin");
    const query = await searchParams;
    return <main className={styles.login}><section className={styles.loginCard}>
        <p>Relaticle operations</p><h1>System access</h1>
        {query.error === undefined ? null : <p className={styles.error} role="alert">{query.error === "rate_limited" ? "Too many attempts. Try again in a minute." : "Invalid email or password."}</p>}
        <form method="post" action="/sysadmin/api/login">
            <label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" required />
            <label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required />
            <button type="submit">Sign in</button>
        </form>
    </section></main>;
};
export default LoginPage;
