"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useState } from "react";

import type { SearchResult } from "@/server/search/service";

import styles from "./crm.module.css";
import { CrmIcon } from "./icon";

export const GlobalSearch = ({ teamSlug }: Readonly<{ teamSlug: string }>) => {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const deferredQuery = useDeferredValue(query);
    const [results, setResults] = useState<readonly SearchResult[]>([]);
    const [active, setActive] = useState(0);
    const close = () => { setOpen(false); setQuery(""); setResults([]); };
    useEffect(() => {
        const listener = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setOpen(true); }
            if (event.key === "Escape") { setOpen(false); setQuery(""); setResults([]); }
        };
        window.addEventListener("keydown", listener);
        return () => window.removeEventListener("keydown", listener);
    }, []);
    useEffect(() => {
        if (!open || deferredQuery.trim().length < 2) return;
        const controller = new AbortController();
        void fetch(`/app/${teamSlug}/search?q=${encodeURIComponent(deferredQuery)}`, { signal: controller.signal }).then(async (response) => response.json() as Promise<{ data: SearchResult[] }>).then(({ data }) => { setResults(data); setActive(0); }).catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setResults([]); });
        return () => controller.abort();
    }, [deferredQuery, open, teamSlug]);
    return <><button type="button" className={styles.searchButton} onClick={() => setOpen(true)}><CrmIcon name="search" /><span>Search</span><kbd>Ctrl K</kbd></button>{open ? <div className={styles.searchBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section className={styles.searchDialog} role="dialog" aria-modal="true" aria-label="Search workspace"><div className={styles.searchInput}><CrmIcon name="search" /><input autoFocus aria-label="Search companies, people, opportunities, tasks, and notes" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => Math.min(results.length - 1, value + 1)); } if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(0, value - 1)); } if (event.key === "Enter") document.getElementById(`search-result-${active}`)?.click(); }} placeholder="Search every record…" /></div><div className={styles.searchResults}>{query.length < 2 ? <p>Type at least two characters.</p> : results.length === 0 ? <p>No matching records.</p> : results.map((result, index) => <Link id={`search-result-${index}`} data-active={active === index} key={`${result.resource}-${result.id}`} href={`/app/${teamSlug}/${result.resource}/${result.id}`} onClick={close}><span><strong>{result.title}</strong><small>{result.context}</small></span><em>{result.resource}</em></Link>)}</div></section></div> : null}</>;
};
