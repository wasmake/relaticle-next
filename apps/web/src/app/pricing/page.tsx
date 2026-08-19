import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/app/_components/marketing-shell";

import styles from "./pricing.module.css";

export const metadata: Metadata = {
    title: "Pricing | Relaticle",
    description: "Simple workspace pricing for Relaticle, with flexible AI credit packs.",
};

const features = [
    "Unlimited relationship records",
    "Shared companies, people, tasks, notes, and opportunities",
    "Workspace roles and secure API access",
    "AI credits that never replace your purchased balance",
] as const;

const PricingPage = () => (
    <MarketingShell><div className={styles.page}>
        <header className={styles.hero}>
            <p className={styles.eyebrow}>Straightforward pricing</p>
            <h1>Relationships compound.<br />Your bill shouldn’t.</h1>
            <p>Start with a full Pro workspace for 14 days. Choose monthly flexibility or save with annual billing when you are ready.</p>
        </header>
        <section className={styles.plans} aria-label="Plans">
            <article className={styles.proPlan}>
                <div><span className={styles.planLabel}>Pro workspace</span><h2>$29 <small>/ month</small></h2><p>One workspace, every core CRM tool, and room for your whole team.</p></div>
                <ul>{features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
                <Link className={styles.primaryAction} href="/app/register">Start 14-day trial</Link>
                <p className={styles.annualNote}>Or $290 yearly, two months included.</p>
            </article>
            <aside className={styles.sidePlans}>
                <article><span className={styles.planLabel}>AI credit pack</span><h2>Top up as needed</h2><p>Purchase extra credits from workspace billing. Purchased credits stay available until used.</p></article>
                <article className={styles.enterprise}><span className={styles.planLabel}>Enterprise</span><h2>Operate on your terms</h2><p>Self-host Relaticle or talk to us about larger deployments and support.</p><a href="mailto:sales@relaticle.com">Talk to us</a></article>
            </aside>
        </section>
        <div className={styles.footer}><p>Open source at the core. No per-seat surprises.</p><Link href="/app/login">Already have a workspace? Sign in</Link></div>
    </div></MarketingShell>
);

export default PricingPage;
