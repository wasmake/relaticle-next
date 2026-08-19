import type { Metadata } from "next";
import Link from "next/link";

import { MarketingShell } from "@/app/_components/marketing-shell";

export const metadata: Metadata = { title: "Terms of Service", description: "Terms governing use of Relaticle’s hosted open-source CRM service.", alternates: { canonical: "/terms-of-service" } };

const Page = () => <MarketingShell><article className="public-article legal-document"><p className="eyebrow">Legal</p><h1>Terms of Service</h1><p className="article-lede">Effective August 19, 2026. These terms govern use of Relaticle’s hosted service.</p>
    <section><h2>1. Services</h2><p>Relaticle is available as a managed cloud service and as software you run on your own infrastructure. These terms apply to the cloud service. Self-hosted installations are governed by the AGPL-3.0 license.</p></section>
    <section><h2>2. Accounts</h2><p>Provide accurate account information, protect your credentials, and notify us if you suspect unauthorized access. You must be at least 16 years old.</p></section>
    <section><h2>3. Your data</h2><p>You own the data you store in Relaticle. Cloud users can export their data through the application or REST API. Self-hosted data remains on infrastructure you control.</p></section>
    <section><h2>4. Acceptable use</h2><p>Do not use the service illegally, access another user’s data, disrupt the service, upload malicious code, or violate others’ intellectual-property rights. We may suspend accounts that violate these rules.</p></section>
    <section><h2>5. API and MCP access</h2><p>API and MCP access is scoped by team and permission. Keep tokens secure and revoke any token you believe is compromised.</p></section>
    <section><h2>6. Pricing and availability</h2><p>Current pricing is shown on the pricing page. We aim for high availability but do not guarantee uninterrupted access.</p></section>
    <section><h2>7. Liability</h2><p>The service is provided “as is” without warranty. To the maximum extent permitted by law, Relaticle is not liable for indirect, incidental, or consequential damages arising from use of the service.</p></section>
    <section><h2>8. Changes and contact</h2><p>We may update these terms and will notify registered users of material changes. Questions? <Link href="/contact">Contact us</Link>.</p></section>
</article></MarketingShell>;
export default Page;
