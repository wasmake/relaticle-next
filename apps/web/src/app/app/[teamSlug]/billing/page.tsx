import Link from "next/link";
import { randomUUID } from "node:crypto";

import { requireBrowserTeam } from "@/server/auth/browser/context";
import { billingIsConfigured } from "@/server/billing/configuration";
import { DrizzleBillingRepository } from "@/server/billing/commerce-repository";

import styles from "./billing.module.css";

type BillingPageProperties = Readonly<{
    params: Promise<{ teamSlug: string }>;
    searchParams: Promise<{ checkout?: string; error?: string; trial?: string }>;
}>;

const readableDate = (date: Date | null): string | null => date === null ? null : new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);

const BillingPage = async ({ params, searchParams }: BillingPageProperties) => {
    const [{ teamSlug }, state] = await Promise.all([params, searchParams]);
    const authentication = await requireBrowserTeam(teamSlug);
    const repository = new DrizzleBillingRepository();
    const [workspace, overview, canManage] = await Promise.all([
        repository.findWorkspace(authentication.context.teamId), repository.billingOverview(authentication.context.teamId),
        repository.canManage(authentication.context.teamId, authentication.context.userId),
    ]);
    if (workspace === undefined) return null;
    const configured = billingIsConfigured();
    const subscriptionDate = readableDate(overview.subscription?.trialEndsAt ?? overview.subscription?.endsAt ?? null);
    const monthlyKey = randomUUID();
    const yearlyKey = randomUUID();
    const creditKey = randomUUID();

    return <main className={styles.page}>
        <aside className={styles.sidebar}><Link className={styles.wordmark} href={`/app/${teamSlug}`}>Relaticle</Link><p>{workspace.name}</p><nav><Link href={`/app/${teamSlug}`}>Overview</Link><Link aria-current="page" href={`/app/${teamSlug}/billing`}>Billing</Link><Link href={`/app/${teamSlug}/settings/team`}>Team settings</Link><Link href="/pricing">Pricing</Link></nav></aside>
        <section className={styles.content}>
            <header><p className={styles.eyebrow}>Workspace billing</p><h1>Plan and credits</h1><p>Keep your workspace active and add AI capacity when the team needs it.</p></header>
            {state.checkout === "success" ? <p className={styles.notice} role="status">Payment confirmed. Your workspace is up to date.</p> : null}
            {state.checkout === "canceled" ? <p className={styles.notice} role="status">Checkout was canceled. Nothing was charged.</p> : null}
            {state.trial === "started" ? <p className={styles.notice} role="status">Your Pro trial has started.</p> : null}
            {state.trial === "used" ? <p className={styles.error} role="alert">This workspace has already used its Pro trial.</p> : null}
            {state.error !== undefined ? <p className={styles.error} role="alert">Billing could not be updated. Please try again.</p> : null}
            {!configured ? <p className={styles.warning}>Hosted billing is not configured on this installation.</p> : null}
            <div className={styles.grid}>
                <article className={styles.planCard}>
                    <div className={styles.cardHeading}><span>Current plan</span><strong>{workspace.plan}</strong></div>
                    <h2>{overview.subscription === null ? "Choose Pro" : `Pro · ${overview.subscription.status.replaceAll("_", " ")}`}</h2>
                    <p>{subscriptionDate === null ? "Unlock the complete relationship workspace for your team." : `Current billing period status through ${subscriptionDate}.`}</p>
                    {canManage && configured ? <div className={styles.actions}>
                        <form method="post" action="/stripe/checkout"><input type="hidden" name="team_slug" value={teamSlug} /><input type="hidden" name="interval" value="monthly" /><input type="hidden" name="idempotency_key" value={monthlyKey} /><button type="submit">Pro monthly · $29</button></form>
                        <form method="post" action="/stripe/checkout"><input type="hidden" name="team_slug" value={teamSlug} /><input type="hidden" name="interval" value="yearly" /><input type="hidden" name="idempotency_key" value={yearlyKey} /><button className={styles.secondary} type="submit">Pro yearly · $290</button></form>
                        {workspace.stripeId === null ? null : <form method="post" action="/stripe/portal"><input type="hidden" name="team_slug" value={teamSlug} /><button className={styles.textButton} type="submit">Manage payment and invoices</button></form>}
                    </div> : null}
                </article>
                <article className={styles.creditCard}><span>AI credit balance</span><strong>{overview.credits.remaining.toLocaleString()}</strong><p>{overview.credits.purchased.toLocaleString()} purchased credits remain in this balance until used.</p>{canManage && configured ? <form method="post" action="/stripe/credit-pack"><input type="hidden" name="team_slug" value={teamSlug} /><input type="hidden" name="idempotency_key" value={creditKey} /><button type="submit">Buy a credit pack</button></form> : null}</article>
                <article className={styles.trialCard}><span>Try every Pro feature</span><h2>{workspace.proTrialUsedAt === null ? "14 days on us" : "Trial already used"}</h2><p>No card is required to explore Pro. A workspace can activate one trial.</p>{canManage && configured && workspace.proTrialUsedAt === null ? <form method="post" action="/stripe/trial"><input type="hidden" name="team_slug" value={teamSlug} /><button type="submit">Start Pro trial</button></form> : null}</article>
            </div>
            {!canManage ? <p className={styles.memberNote}>You can view billing. A workspace owner or administrator must make changes.</p> : null}
        </section>
    </main>;
};

export default BillingPage;
