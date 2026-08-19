const legacyMap: Readonly<Record<string, string>> = {
    quickstart: "/help/getting-started",
    "getting-started": "/help/getting-started",
    import: "/help/import",
    developer: "/developers/contributing",
    "self-hosting": "/developers/self-hosting",
    mcp: "/developers/mcp",
    contributing: "/developers/contributing",
    api: "/developers/api",
};

export const legacyDocumentationTarget = (segments: string[] = []): string => {
    const slug = segments.join("/");
    return legacyMap[slug] ?? "/developers";
};
