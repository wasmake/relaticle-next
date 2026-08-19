import Link from "next/link";
import { JsonLd, MarketingShell } from "./_components/marketing-shell";

const HomePage = () => (
    <MarketingShell>
      <div className="marketing-page">
        <section className="hero">
            <p className="eyebrow">Open-source relationship workspace</p>
            <h1>The CRM for work that starts with a conversation.</h1>
            <p className="hero-copy">
                Keep companies, people, opportunities, tasks, and notes in one
                calm system your team can shape around the way it actually works.
            </p>
            <div className="hero-actions">
                <Link href="/app/register" className="primary-action">Start a workspace</Link>
                <Link href="/developers" className="secondary-action">Explore the API</Link>
            </div>
        </section>
        <section id="features" className="product-strip" aria-label="Product capabilities">
            <article><span>01</span><h2>Model every relationship</h2><p>Custom fields and linked records without a rigid schema.</p></article>
            <article><span>02</span><h2>Move work together</h2><p>Assignments, notes, activity, and pipeline context stay close.</p></article>
            <article><span>03</span><h2>Own the system</h2><p>Node.js, PostgreSQL, Redis, and an open API on your infrastructure.</p></article>
        </section>
        <JsonLd data={{ "@context": "https://schema.org", "@graph": [{ "@type": "Organization", name: "Relaticle", url: process.env.APP_URL ?? "https://relaticle.com", logo: `${process.env.APP_URL ?? "https://relaticle.com"}/web-app-manifest-512x512.png`, sameAs: ["https://github.com/relaticle/relaticle"] }, { "@type": "WebSite", name: "Relaticle", url: process.env.APP_URL ?? "https://relaticle.com" }] }} />
      </div>
    </MarketingShell>
);

export default HomePage;
