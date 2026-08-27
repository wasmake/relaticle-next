"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useState } from "react";

import type { SearchResult } from "@/server/search/service";

import { CrmIcon } from "./icon";

const focusRing =
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-workspace-primary focus-visible:ring-offset-2";

export const GlobalSearch = ({ teamSlug }: Readonly<{ teamSlug: string }>) => {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const deferredQuery = useDeferredValue(query);
    const [results, setResults] = useState<readonly SearchResult[]>([]);
    const [active, setActive] = useState(0);
    const close = () => {
        setOpen(false);
        setQuery("");
        setResults([]);
    };

    useEffect(() => {
        const listener = (event: KeyboardEvent) => {
            if (
                (event.metaKey || event.ctrlKey) &&
                event.key.toLowerCase() === "k"
            ) {
                event.preventDefault();
                setOpen(true);
            }
            if (event.key === "Escape") close();
        };
        window.addEventListener("keydown", listener);
        return () => window.removeEventListener("keydown", listener);
    }, []);

    useEffect(() => {
        if (!open || deferredQuery.trim().length < 2) return;
        const controller = new AbortController();
        void fetch(
            `/app/${teamSlug}/search?q=${encodeURIComponent(deferredQuery)}`,
            { signal: controller.signal },
        )
            .then(
                async (response) =>
                    response.json() as Promise<{ data: SearchResult[] }>,
            )
            .then(({ data }) => {
                setResults(data);
                setActive(0);
            })
            .catch((error: unknown) => {
                if (!(
                    error instanceof DOMException && error.name === "AbortError"
                ))
                    setResults([]);
            });
        return () => controller.abort();
    }, [deferredQuery, open, teamSlug]);

    return (
        <>
            <button
                type="button"
                className={`flex h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-control border border-workspace-border bg-nav-active px-3 text-caption font-medium text-workspace-muted shadow-control hover:bg-nav-hover hover:text-workspace-text ${focusRing} sidebar-collapsed:hidden`}
                onClick={() => setOpen(true)}
            >
                <CrmIcon className="size-4 shrink-0" name="search" />
                <span>Search</span>
                <kbd className="ml-auto whitespace-nowrap rounded-md border border-workspace-border bg-workspace-surface px-1.5 py-0.5 font-ui text-pico font-medium leading-none">
                    Ctrl K
                </kbd>
            </button>
            {open ? (
                <div
                    className="fixed inset-0 z-50 grid justify-items-center bg-workspace-text/40 px-4 pt-24"
                    role="presentation"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) close();
                    }}
                >
                    <section
                        className="w-full max-w-xl self-start overflow-hidden rounded-panel border border-workspace-border bg-workspace-surface shadow-popover"
                        role="dialog"
                        aria-modal="true"
                        aria-label="Search workspace"
                    >
                        <div className="flex items-center border-b border-workspace-border">
                            <CrmIcon
                                className="ml-4 size-5 shrink-0 text-workspace-subtle"
                                name="search"
                            />
                            <input
                                className="w-full border-0 bg-transparent p-4 text-ui font-normal text-workspace-text outline-none placeholder:text-workspace-subtle"
                                autoFocus
                                aria-label="Search companies, people, opportunities, tasks, and notes"
                                value={query}
                                onChange={(event) =>
                                    setQuery(event.target.value)
                                }
                                onKeyDown={(event) => {
                                    if (event.key === "ArrowDown") {
                                        event.preventDefault();
                                        setActive((value) =>
                                            Math.min(
                                                results.length - 1,
                                                value + 1,
                                            ),
                                        );
                                    }
                                    if (event.key === "ArrowUp") {
                                        event.preventDefault();
                                        setActive((value) =>
                                            Math.max(0, value - 1),
                                        );
                                    }
                                    if (event.key === "Enter")
                                        document
                                            .getElementById(
                                                `search-result-${active}`,
                                            )
                                            ?.click();
                                }}
                                placeholder="Search every record..."
                            />
                        </div>
                        <div className="max-h-96 overflow-y-auto">
                            {query.length < 2 ? (
                                <p className="m-0 p-5 text-ui text-workspace-muted">
                                    Type at least two characters.
                                </p>
                            ) : results.length === 0 ? (
                                <p className="m-0 p-5 text-ui text-workspace-muted">
                                    No matching records.
                                </p>
                            ) : (
                                results.map((result, index) => (
                                    <Link
                                        className={`flex items-center justify-between gap-4 px-4 py-3 text-workspace-text no-underline hover:bg-nav-active ${focusRing}`}
                                        id={`search-result-${index}`}
                                        data-active={active === index}
                                        key={`${result.resource}-${result.id}`}
                                        href={`/app/${teamSlug}/${result.resource}/${result.id}`}
                                        onClick={close}
                                    >
                                        <span className="grid min-w-0 gap-1">
                                            <strong className="truncate text-ui font-semibold">
                                                {result.title}
                                            </strong>
                                            <small className="truncate text-caption font-normal text-workspace-muted">
                                                {result.context}
                                            </small>
                                        </span>
                                        <em className="shrink-0 text-caption font-normal not-italic text-workspace-muted capitalize">
                                            {result.resource}
                                        </em>
                                    </Link>
                                ))
                            )}
                        </div>
                    </section>
                </div>
            ) : null}
        </>
    );
};
