import Link from "next/link";
import type { ReactNode } from "react";

export const MarketingHeader = () => (
    <header className="site-header">
        <Link href="/" className="wordmark" aria-label="Relaticle home">Relaticle</Link>
        <nav className="desktop-nav" aria-label="Primary">
            <Link href="/#features">Features</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/help">Help</Link>
            <Link href="/developers">Developers</Link>
            <Link href="/contact">Contact</Link>
        </nav>
        <div className="header-actions">
            <Link href="/app/login">Sign in</Link>
            <Link href="/app/register" className="nav-cta">Start free</Link>
        </div>
        <Link href="/app/login" className="mobile-sign-in">Sign in</Link>
        <details className="mobile-nav">
            <summary aria-label="Open navigation">Menu</summary>
            <nav aria-label="Mobile primary">
                <Link href="/#features">Features</Link><Link href="/pricing">Pricing</Link>
                <Link href="/help">Help</Link><Link href="/developers">Developers</Link>
                <Link href="/contact">Contact</Link><Link href="/app/login">Sign in</Link>
                <Link href="/app/register">Start free</Link>
            </nav>
        </details>
    </header>
);

export const MarketingFooter = () => (
    <footer className="site-footer">
        <section><Link href="/" className="wordmark">Relaticle</Link><p>The open-source CRM for people and AI-powered work. Self-hosted, flatly priced, and yours to own.</p></section>
        <nav aria-label="Product"><strong>Product</strong><Link href="/pricing">Pricing</Link><Link href="/developers">Developers</Link><Link href="/help">Help centre</Link><Link href="/press">Press kit</Link></nav>
        <nav aria-label="Compare"><strong>Compare</strong><Link href="/compare/relaticle-vs-twenty">Relaticle vs Twenty</Link><Link href="/compare/relaticle-vs-espocrm">Relaticle vs EspoCRM</Link><Link href="/alternatives/attio">Attio alternative</Link><Link href="/alternatives/hubspot">HubSpot alternative</Link></nav>
        <nav aria-label="Legal"><strong>Support & legal</strong><Link href="/contact">Contact</Link><Link href="/privacy-policy">Privacy policy</Link><Link href="/terms-of-service">Terms of service</Link><a href="https://github.com/relaticle/relaticle" rel="noreferrer">GitHub</a></nav>
        <small>© 2026 Relaticle. All rights reserved.</small>
    </footer>
);

export const MarketingShell = ({ children }: Readonly<{ children: ReactNode }>) => (
    <div className="public-page"><MarketingHeader /><main>{children}</main><MarketingFooter /></div>
);

export const JsonLd = ({ data }: Readonly<{ data: unknown }>) => {
    const json = JSON.stringify(data).replaceAll("<", "\\u003c");
    return <script type="application/ld+json">{json}</script>;
};
