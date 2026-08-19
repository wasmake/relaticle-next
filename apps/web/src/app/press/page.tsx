import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { JsonLd, MarketingShell } from "@/app/_components/marketing-shell";
import { competitorFacts } from "@/server/marketing/content";

export const metadata: Metadata = { title: "Press Kit & Facts", description: "Relaticle company facts, product screenshots, and brand assets for journalists.", alternates: { canonical: "/press" }, openGraph: { title: "Press Kit & Facts - Relaticle", description: "Company facts and downloadable product and brand assets.", type: "website", images: ["/images/open-graph.jpg"] } };
const screenshots = [
    ["app-pipeline-preview.webp", "Pipeline board", "Relaticle opportunities board with deals grouped into pipeline stages"],
    ["app-companies-preview.webp", "Companies list", "Relaticle companies list with account context"],
    ["app-custom-fields-preview.webp", "Custom fields", "Relaticle custom fields settings for CRM records"],
] as const;

const Page = () => <MarketingShell><article className="public-article press-page"><p className="eyebrow">Press kit</p><h1>Press Kit & Facts</h1><p className="article-lede">Relaticle is a self-host-first, open-source CRM for people and AI-powered work.</p>
    <section><h2>Company facts</h2><dl className="facts-list"><div><dt>Founded</dt><dd>2024</dd></div><div><dt>License</dt><dd>{competitorFacts.relaticle.license}</dd></div><div><dt>Technology</dt><dd>{competitorFacts.relaticle.stack}</dd></div><div><dt>Pricing</dt><dd>{competitorFacts.relaticle.pricing}</dd></div><div><dt>AI & MCP</dt><dd>{competitorFacts.relaticle.ai}</dd></div><div><dt>Source</dt><dd><a href="https://github.com/relaticle/relaticle" rel="noreferrer">github.com/relaticle/relaticle</a></dd></div></dl></section>
    <section><h2>Product screenshots</h2><div className="press-assets">{screenshots.map(([file, caption, alt]) => <figure key={file}><Image src={`/images/${file}`} width={1440} height={900} alt={alt} /><figcaption>{caption}</figcaption></figure>)}</div></section>
    <section><h2>Logo & brand assets</h2><div className="brand-download"><Image src="/brand/logomark.svg" width={64} height={64} alt="Relaticle logomark" /><a href="/brand/logomark.svg" download>Download logomark (SVG)</a><a href="/brand/logo-white.png" download>Download white logo (PNG)</a></div></section>
    <section className="article-cta"><h2>Press contact</h2><p>For interviews, quotes, or other material, contact the team.</p><Link href="/contact" className="primary-action">Contact us</Link></section>
    <JsonLd data={{ "@context": "https://schema.org", "@type": "Organization", name: "Relaticle", url: process.env.APP_URL ?? "https://relaticle.com", logo: `${process.env.APP_URL ?? "https://relaticle.com"}/web-app-manifest-512x512.png`, sameAs: ["https://github.com/relaticle/relaticle", "https://x.com/relaticle"] }} />
</article></MarketingShell>;
export default Page;
