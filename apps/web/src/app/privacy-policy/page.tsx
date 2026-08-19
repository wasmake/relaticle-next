import type { Metadata } from "next";
import Link from "next/link";

import { MarketingShell } from "@/app/_components/marketing-shell";

export const metadata: Metadata = { title: "Privacy Policy", description: "How Relaticle collects, uses, and protects personal data.", alternates: { canonical: "/privacy-policy" } };

const Page = () => <MarketingShell><article className="public-article legal-document"><p className="eyebrow">Legal</p><h1>Privacy Policy</h1><p className="article-lede">Effective August 19, 2026. This policy explains how Relaticle handles personal data.</p>
    <section><h2>1. What we collect</h2><p>Cloud users provide account and profile information and the CRM records they create. We process technical and usage data needed to operate and secure the service. Website contact submissions include your name, email, company, and message. We do not collect data from self-hosted installations.</p></section>
    <section><h2>2. How we use data</h2><p>We use data to provide and secure the CRM, authenticate users, send transactional messages, improve reliability, and answer support inquiries. We do not sell CRM data, use it for advertising, or train AI models on it.</p></section>
    <section><h2>3. Service providers</h2><p>Cloud infrastructure and email providers process only the information needed to deliver their services. We do not share CRM data except where required to operate the service or by law.</p></section>
    <section><h2>4. Security and retention</h2><p>We use encrypted connections, team-based access controls, scoped tokens, and regular dependency updates. Contact submissions are retained for up to 12 months, server logs for up to 90 days, and deleted-account data for no more than 30 days.</p></section>
    <section><h2>5. Your rights</h2><p>You may access, export, correct, or delete your data and object to specific processing. <Link href="/contact">Contact us</Link> to exercise these rights.</p></section>
    <section><h2>6. Cookies</h2><p>We use essential cookies for sessions, security, and preferences. We do not use third-party advertising cookies.</p></section>
    <section><h2>7. AI connectors and MCP</h2><p>Authorized connectors can access only CRM records available to your team and only with the permissions granted. Tokens can be revoked. Relaticle’s MCP server does not store your assistant’s conversation context.</p></section>
    <section><h2>8. Children, changes, and contact</h2><p>The service is not directed to children under 16. We will notify registered users of material policy changes. Questions? <Link href="/contact">Contact us</Link>.</p></section>
</article></MarketingShell>;
export default Page;
