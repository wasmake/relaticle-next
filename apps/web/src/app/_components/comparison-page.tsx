import Link from "next/link";

import { JsonLd, MarketingShell } from "./marketing-shell";
import { competitorFacts, type CompetitorFacts } from "@/server/marketing/content";

const rows: ReadonlyArray<readonly [string, keyof CompetitorFacts]> = [
    ["License", "license"], ["Pricing", "pricing"], ["Deployment", "selfHost"],
    ["Technology", "stack"], ["AI", "ai"], ["Extensibility", "extensibility"],
];

export const ComparisonPage = ({ title, badge, description, opening, competitor, migration = false }: Readonly<{
    title: string; badge: string; description: string; opening: string;
    competitor: CompetitorFacts; migration?: boolean;
}>) => {
    const relaticle: CompetitorFacts = competitorFacts.relaticle;
    return (
        <MarketingShell>
            <article className="public-article comparison-article">
                <p className="eyebrow">{badge}</p><h1>{title}</h1><p className="article-lede">{opening}</p>
                <section><h2>At a glance</h2><div className="comparison-scroll"><table><thead><tr><th>Dimension</th><th>Relaticle</th><th>{competitor.name}</th></tr></thead><tbody>{rows.map(([label, key]) => <tr key={key}><th>{label}</th><td>{relaticle[key]}</td><td>{competitor[key]}</td></tr>)}</tbody></table></div></section>
                <div className="dimension-grid">
                    <section><h2>Ownership & deployment</h2><p>{relaticle.selfHost}. {competitor.name}: {competitor.selfHost.toLowerCase()}.</p></section>
                    <section><h2>AI & extensibility</h2><p>Relaticle ships {relaticle.ai.toLowerCase()}. {competitor.name} offers {competitor.ai.toLowerCase()}.</p></section>
                    <section><h2>Pricing model</h2><p>Relaticle uses {relaticle.pricing.toLowerCase()}. {competitor.name}: {competitor.pricing.toLowerCase()}.</p></section>
                    <section><h2>Technology</h2><p>Relaticle uses {relaticle.stack}. {competitor.name} uses {competitor.stack.toLowerCase()}.</p></section>
                </div>
                {migration ? <section className="inset-panel"><h2>Migrating from {competitor.name}</h2><p>Export companies, people, and deals as CSV, then use Relaticle’s import workflow to map fields and review records before creating them.</p><Link href="/help/import">Read the import guide</Link></section> : null}
                <p className="fact-date">Facts last verified {relaticle.verified}.</p>
                <section className="article-cta"><h2>Try Relaticle yourself</h2><p>Self-host free under AGPL-3.0, or start a hosted workspace.</p><Link className="primary-action" href="/app/register">Start for free</Link><Link className="secondary-action" href="/contact">Get in touch</Link></section>
            </article>
            <JsonLd data={{ "@context": "https://schema.org", "@graph": [{ "@type": "WebPage", name: title, description }, { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Relaticle", item: process.env.APP_URL ?? "https://relaticle.com" }, { "@type": "ListItem", position: 2, name: title }] }] }} />
        </MarketingShell>
    );
};
