export type CompetitorFacts = Readonly<{
    name: string;
    license: string;
    pricing: string;
    stack: string;
    selfHost: string;
    ai: string;
    extensibility: string;
    verified: string;
}>;

export const competitorFacts = {
    relaticle: {
        name: "Relaticle",
        license: "AGPL-3.0",
        pricing: "$24/mo flat ($19/mo billed annually), unlimited users",
        stack: "Node.js, PostgreSQL, Redis, and a single-server-friendly deployment",
        selfHost: "Self-host free under AGPL-3.0, with no feature gating",
        ai: "A built-in AI assistant and first-party MCP server that work self-hosted",
        extensibility: "REST API, MCP server, custom fields, and a fully open codebase",
        verified: "August 13, 2026",
    },
    twenty: {
        name: "Twenty",
        license: "AGPL-3.0 with the Twenty Application Exception",
        pricing: "Per-seat plans, with enterprise pricing available",
        stack: "Node, NestJS, Redis, PostgreSQL, and background workers",
        selfHost: "Self-hostable core; some enterprise files are license-restricted",
        ai: "First-party MCP tooling marketed for cloud workspaces",
        extensibility: "A TypeScript apps SDK for custom objects, logic, and UI",
        verified: "August 13, 2026",
    },
    espocrm: {
        name: "EspoCRM",
        license: "AGPL-3.0",
        pricing: "Per-user cloud plans with minimum seat counts",
        stack: "PHP and a single-server-friendly deployment",
        selfHost: "Free self-hosted core with paid extensions available",
        ai: "No first-party AI assistant or MCP server",
        extensibility: "Third-party marketplaces and paid extensions",
        verified: "August 13, 2026",
    },
    attio: {
        name: "Attio",
        license: "Closed-source SaaS",
        pricing: "Free for small teams, then per-seat paid plans",
        stack: "Proprietary cloud stack",
        selfHost: "No self-hosting option",
        ai: "Proprietary research and enrichment features",
        extensibility: "REST API, native integrations, Zapier, and Make",
        verified: "August 13, 2026",
    },
    hubspot: {
        name: "HubSpot",
        license: "Closed-source SaaS",
        pricing: "Free CRM, then per-seat and per-Hub paid plans",
        stack: "Proprietary cloud stack",
        selfHost: "No self-hosting option",
        ai: "Proprietary AI features bundled with paid Hubs",
        extensibility: "A broad official marketplace for integrations and templates",
        verified: "August 13, 2026",
    },
} as const satisfies Readonly<Record<string, CompetitorFacts>>;

export const comparisonSlugs = ["twenty", "espocrm"] as const;
export const alternativeSlugs = ["attio", "hubspot"] as const;
export type ComparisonSlug = (typeof comparisonSlugs)[number];
export type AlternativeSlug = (typeof alternativeSlugs)[number];

export const comparisonCopy: Record<ComparisonSlug, Readonly<{ opening: string; description: string }>> = {
    twenty: {
        opening: "Both are open-source, self-hostable CRMs. Choose Relaticle for flat team pricing and AI tooling that runs on your infrastructure; choose Twenty for its larger community or a NestJS-based stack.",
        description: "Relaticle vs Twenty compared on license, pricing, deployment, extensibility, and self-hosted AI.",
    },
    espocrm: {
        opening: "Both are AGPL-3.0 and self-host-first. Choose Relaticle when a built-in AI assistant and MCP access matter; choose EspoCRM for its longer track record and extension ecosystem.",
        description: "Relaticle vs EspoCRM compared on license, pricing, deployment, extensibility, and AI tooling.",
    },
};

export const alternativeCopy: Record<AlternativeSlug, Readonly<{ opening: string; description: string }>> = {
    attio: {
        opening: "Attio offers a polished, flexible SaaS CRM. Relaticle is the alternative for teams that want to own their data, self-host their CRM and AI tooling, and avoid per-seat pricing.",
        description: "A self-hosted, open-source Attio alternative with flat pricing, custom fields, REST API, and built-in AI.",
    },
    hubspot: {
        opening: "HubSpot offers a mature suite spanning marketing, sales, and service. Relaticle is the focused alternative for teams that want open source, self-hosting, built-in AI, and predictable team pricing.",
        description: "A self-hosted, open-source HubSpot alternative with flat pricing, data ownership, and built-in AI.",
    },
};

export const publicRoutes = [
    "/",
    "/pricing",
    "/contact",
    "/terms-of-service",
    "/privacy-policy",
    "/press",
    ...comparisonSlugs.map((slug) => `/compare/relaticle-vs-${slug}`),
    ...alternativeSlugs.map((slug) => `/alternatives/${slug}`),
] as const;
