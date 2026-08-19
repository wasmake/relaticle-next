import Link from "next/link";

import styles from "@/components/sysadmin/admin.module.css";
import { dashboardMetrics } from "@/server/sysadmin/resources";

const DashboardPage = async () => {
    const metrics = await dashboardMetrics();
    return <><header className={styles.header}><div><p>System overview</p><h1>Operations pulse</h1></div></header><section className={styles.metrics}>{metrics.map((metric) => <Link className={styles.metric} href={metric.href} key={metric.href}><span>{metric.label}</span><strong>{metric.value.toLocaleString()}</strong></Link>)}</section></>;
};
export default DashboardPage;
