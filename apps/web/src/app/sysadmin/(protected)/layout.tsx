import Link from "next/link";
import type { ReactNode } from "react";

import styles from "@/components/sysadmin/admin.module.css";
import { adminResources } from "@/server/sysadmin/resources";
import { canSystemAdministrator } from "@/server/sysadmin/http";
import { requireSystemAdministrator } from "@/server/sysadmin/session";

const ProtectedLayout = async ({ children }: Readonly<{ children: ReactNode }>) => {
    const administrator = await requireSystemAdministrator();
    return <div className={styles.shell}><aside className={styles.sidebar}>
        <Link className={styles.brand} href="/sysadmin">Relaticle System</Link>
        <p className={styles.identity}>{administrator.name} · {administrator.role}</p>
        <nav className={styles.nav} aria-label="System resources">
            {adminResources.filter((resource) => canSystemAdministrator(administrator, "read", resource)).map((resource) => <Link href={`/sysadmin/${resource.slug}`} key={resource.slug}>{resource.label}</Link>)}
        </nav>
        <form method="post" action="/sysadmin/api/logout"><button className={styles.logout}>Sign out</button></form>
    </aside><main className={styles.content}>{children}</main></div>;
};
export default ProtectedLayout;
