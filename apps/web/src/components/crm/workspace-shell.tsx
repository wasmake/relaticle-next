import Link from "next/link";
import type { ReactNode } from "react";

import type { CrmResource } from "@/app/app/[teamSlug]/_crm-data";
import { requireBrowserTeam } from "@/server/auth/browser/context";
import { chatService } from "@/server/chat/production";

import { GlobalSearch } from "./global-search";
import { CrmIcon, type CrmIconName } from "./icon";

const resources: readonly Readonly<{
    slug: CrmResource;
    label: string;
    icon: CrmIconName;
}>[] = [
    { slug: "people", label: "People", icon: "people" },
    { slug: "companies", label: "Companies", icon: "building" },
    { slug: "opportunities", label: "Opportunities", icon: "trophy" },
    { slug: "tasks", label: "Tasks", icon: "task" },
    { slug: "notes", label: "Notes", icon: "note" },
];

type WorkspaceShellProperties = Readonly<{
    teamSlug: string;
    teamName: string;
    active: CrmResource | "chat" | "overview" | "settings";
    children: ReactNode;
}>;

const focusRing =
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-workspace-primary focus-visible:ring-offset-2";
const navItem = `group flex h-nav-item min-w-0 items-center gap-3 rounded-control px-3 text-ui font-medium no-underline transition-colors hover:bg-nav-hover hover:text-workspace-text ${focusRing} sidebar-collapsed:justify-center sidebar-collapsed:px-0`;
const activeNavItem = "bg-nav-active font-semibold text-workspace-primary-text";
const iconClass =
    "size-5 shrink-0 text-workspace-subtle transition-colors group-aria-[current=page]:text-workspace-primary group-hover:text-workspace-muted";

const initials = (value: string): string =>
    value
        .split(/\s+/u)
        .filter(Boolean)
        .map((word) => word[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();

const WorkspaceLink = ({
    active,
    href,
    icon,
    label,
}: Readonly<{
    active: boolean;
    href: string;
    icon: CrmIconName;
    label: string;
}>) => (
    <Link
        className={`${navItem} ${active ? activeNavItem : "text-workspace-muted"}`}
        href={href}
        aria-current={active ? "page" : undefined}
    >
        <CrmIcon className={iconClass} name={icon} />
        <span className="min-w-0 truncate sidebar-collapsed:hidden">
            {label}
        </span>
    </Link>
);

const ConversationLink = ({
    href,
    title,
}: Readonly<{ href: string; title: string }>) => (
    <Link
        className={`${navItem} text-workspace-muted`}
        href={href}
        title={title}
    >
        <CrmIcon className={iconClass} name="chat" />
        <span className="min-w-0 truncate sidebar-collapsed:hidden">
            {title || "Untitled chat"}
        </span>
    </Link>
);

export const WorkspaceShell = async ({
    teamSlug,
    teamName,
    active,
    children,
}: WorkspaceShellProperties) => {
    const authentication = await requireBrowserTeam(teamSlug);
    const conversations = await chatService.listConversations(
        authentication.context,
    );
    const visibleConversations = conversations.slice(0, 7);
    const userInitials = initials(authentication.user.name);
    const workspaceMenuItems = [
        {
            label: "Workspace settings",
            href: `/app/${teamSlug}/settings/team`,
        },
        {
            label: "Custom fields",
            href: `/app/${teamSlug}/settings/custom-fields`,
        },
        { label: "Billing", href: `/app/${teamSlug}/billing` },
        {
            label: "API tokens",
            href: `/app/${teamSlug}/settings/api-tokens`,
        },
        { label: "Switch workspace", href: "/app/new" },
    ];

    return (
        <main className="workspace-shell flex min-h-dvh bg-workspace-canvas font-ui text-workspace-text workspace-mobile:block">
            <input
                className="peer/sidebar sr-only"
                id="workspace-sidebar-toggle"
                type="checkbox"
            />

            <header className="sticky top-0 z-30 hidden h-16 w-full items-center gap-3 border-b border-workspace-border bg-workspace-surface px-4 workspace-mobile:flex">
                <details className="group/mobile">
                    <summary
                        className={`grid size-11 cursor-pointer list-none place-items-center rounded-control text-workspace-muted hover:bg-nav-hover hover:text-workspace-text ${focusRing}`}
                        aria-label="Open navigation"
                    >
                        <CrmIcon className="size-5" name="menu" />
                    </summary>
                    <div className="fixed inset-x-0 bottom-0 top-16 z-40 bg-workspace-text/35">
                        <nav
                            className="h-full w-72 overflow-y-auto border-r border-workspace-border bg-workspace-surface p-4 shadow-popover"
                            aria-label="Workspace"
                        >
                            <div className="grid gap-1">
                                <WorkspaceLink
                                    active={active === "overview"}
                                    href={`/app/${teamSlug}`}
                                    icon="dashboard"
                                    label="Home"
                                />
                                {resources.map(({ icon, label, slug }) => (
                                    <WorkspaceLink
                                        key={slug}
                                        active={active === slug}
                                        href={`/app/${teamSlug}/${slug}`}
                                        icon={icon}
                                        label={label}
                                    />
                                ))}
                            </div>
                            <div className="mt-6 border-t border-workspace-border pt-4">
                                <div className="flex h-8 items-center px-3 text-caption font-semibold uppercase tracking-wider text-workspace-muted">
                                    Chats
                                </div>
                                <div className="grid gap-1">
                                    {visibleConversations.map(
                                        (conversation) => (
                                            <ConversationLink
                                                key={conversation.id}
                                                href={`/app/${teamSlug}/chat?conversation=${conversation.id}`}
                                                title={conversation.title}
                                            />
                                        ),
                                    )}
                                    <Link
                                        className={`${navItem} text-workspace-muted`}
                                        href={`/app/${teamSlug}/chat`}
                                    >
                                        <CrmIcon
                                            className={iconClass}
                                            name="dots"
                                        />
                                        <span className="truncate">
                                            All chats
                                        </span>
                                    </Link>
                                </div>
                            </div>
                        </nav>
                    </div>
                </details>
                <strong className="min-w-0 flex-1 truncate text-ui font-semibold">
                    {teamName}
                </strong>
                <Link
                    href="/app/settings/profile"
                    className={`grid size-9 place-items-center justify-self-end rounded-full bg-workspace-avatar text-xs font-semibold leading-4 text-white no-underline ${focusRing}`}
                    aria-label="Account settings"
                >
                    {userInitials}
                </Link>
            </header>

            <aside className="sticky top-0 z-20 flex h-dvh w-sidebar-width shrink-0 flex-col overflow-hidden border-r border-workspace-border bg-workspace-surface sidebar-collapsed:w-sidebar-collapsed workspace-mobile:hidden">
                <details className="group relative">
                    <summary
                        className={`flex h-16 cursor-pointer list-none items-center gap-3 px-sidebar-x text-workspace-text hover:bg-nav-hover ${focusRing} sidebar-collapsed:justify-center sidebar-collapsed:px-3`}
                    >
                        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-zinc-950 text-pico font-bold leading-none text-white">
                            {initials(teamName)}
                        </span>
                        <strong className="min-w-0 flex-1 truncate text-ui font-semibold sidebar-collapsed:hidden">
                            {teamName}
                        </strong>
                        <CrmIcon
                            className="size-4 shrink-0 rotate-90 text-workspace-subtle transition-transform group-open:-rotate-90 sidebar-collapsed:hidden"
                            name="chevron"
                        />
                    </summary>
                    <nav
                        className="absolute inset-x-4 top-full z-50 mt-1 grid rounded-control border border-workspace-border bg-workspace-surface p-2 shadow-popover sidebar-collapsed:left-3 sidebar-collapsed:right-auto sidebar-collapsed:w-64"
                        aria-label="Workspace menu"
                    >
                        {workspaceMenuItems.map(({ label, href }) => (
                            <Link
                                className={`rounded-lg px-3 py-2 text-caption font-medium text-workspace-muted no-underline hover:bg-workspace-primary-soft hover:text-workspace-primary-text ${focusRing}`}
                                href={href}
                                key={label}
                            >
                                {label}
                            </Link>
                        ))}
                    </nav>
                </details>

                <div className="flex gap-2 border-t border-workspace-border px-sidebar-x py-3 sidebar-collapsed:justify-center sidebar-collapsed:px-3">
                    <GlobalSearch teamSlug={teamSlug} />
                    <Link
                        href="/app/settings/notifications"
                        className={`grid size-9 shrink-0 place-items-center rounded-control border border-workspace-border text-workspace-muted no-underline shadow-control hover:bg-nav-hover hover:text-workspace-text ${focusRing}`}
                        aria-label="Notifications"
                    >
                        <CrmIcon className="size-4" name="inbox" />
                    </Link>
                </div>

                <nav
                    aria-label="Workspace"
                    className="flex flex-1 flex-col overflow-y-auto px-sidebar-x pb-4 pt-1 sidebar-collapsed:px-3"
                >
                    <div className="grid gap-0.5">
                        <WorkspaceLink
                            active={active === "overview"}
                            href={`/app/${teamSlug}`}
                            icon="dashboard"
                            label="Home"
                        />
                        {resources.map(({ icon, label, slug }) => (
                            <WorkspaceLink
                                key={slug}
                                active={active === slug}
                                href={`/app/${teamSlug}/${slug}`}
                                icon={icon}
                                label={label}
                            />
                        ))}
                    </div>

                    <section className="mt-6">
                        <header className="flex h-8 items-center px-3 text-caption font-semibold uppercase tracking-wider text-workspace-muted sidebar-collapsed:justify-center sidebar-collapsed:px-0">
                            <span className="sidebar-collapsed:hidden">
                                Chats
                            </span>
                            <CrmIcon
                                className="hidden size-5 text-workspace-subtle sidebar-collapsed:block"
                                name="chat"
                            />
                        </header>
                        <div className="grid gap-0.5">
                            {visibleConversations.length === 0 ? (
                                <p className="m-0 px-3 py-2 text-caption text-workspace-muted sidebar-collapsed:hidden">
                                    No chats yet. Start one from Home.
                                </p>
                            ) : (
                                visibleConversations.map((conversation) => (
                                    <ConversationLink
                                        key={conversation.id}
                                        href={`/app/${teamSlug}/chat?conversation=${conversation.id}`}
                                        title={conversation.title}
                                    />
                                ))
                            )}
                            {conversations.length > 7 ? (
                                <Link
                                    className={`${navItem} text-workspace-subtle`}
                                    href={`/app/${teamSlug}/chat`}
                                >
                                    <CrmIcon
                                        className={iconClass}
                                        name="dots"
                                    />
                                    <span className="truncate sidebar-collapsed:hidden">
                                        All chats
                                    </span>
                                </Link>
                            ) : null}
                        </div>
                    </section>
                </nav>
            </aside>

            <section className="min-w-0 flex-1 workspace-mobile:w-full">
                <header className="sticky top-0 z-10 flex h-topbar items-center justify-between border-b border-workspace-border bg-workspace-surface/95 px-6 backdrop-blur-sm workspace-mobile:hidden">
                    <label
                        className={`grid size-9 cursor-pointer place-items-center rounded-control text-workspace-muted hover:bg-nav-hover hover:text-workspace-text peer-focus-visible/sidebar:ring-2 peer-focus-visible/sidebar:ring-workspace-primary peer-focus-visible/sidebar:ring-offset-2`}
                        htmlFor="workspace-sidebar-toggle"
                        aria-label="Collapse sidebar"
                    >
                        <CrmIcon
                            className="size-5 rotate-180 transition-transform sidebar-collapsed:rotate-0"
                            name="chevron"
                        />
                    </label>
                    <div className="flex items-center gap-4">
                        <Link
                            href={`/app/${teamSlug}/chat`}
                            className={`inline-flex h-9 items-center gap-2 rounded-control border border-workspace-border bg-workspace-surface px-3 text-caption font-semibold text-zinc-900 no-underline shadow-control hover:bg-nav-hover ${focusRing}`}
                        >
                            <CrmIcon
                                className="size-4 text-workspace-subtle"
                                name="chat"
                            />
                            Ask Relaticle
                        </Link>
                        <details className="group relative">
                            <summary
                                className={`grid size-9 cursor-pointer list-none place-items-center rounded-full bg-workspace-avatar text-xs font-semibold leading-4 text-white ${focusRing}`}
                                aria-label="Account settings"
                            >
                                {userInitials}
                            </summary>
                            <nav
                                className="absolute right-0 top-full z-50 mt-2 grid w-52 rounded-control border border-workspace-border bg-workspace-surface p-2 shadow-popover"
                                aria-label="Account menu"
                            >
                                <strong className="truncate px-3 pt-1 text-caption font-semibold">
                                    {authentication.user.name}
                                </strong>
                                <small className="mb-2 truncate px-3 pb-1 text-micro font-normal leading-4 text-workspace-muted">
                                    {authentication.user.email}
                                </small>
                                <Link
                                    className={`rounded-lg px-3 py-2 text-caption text-workspace-muted no-underline hover:bg-workspace-primary-soft hover:text-workspace-primary-text ${focusRing}`}
                                    href="/app/settings/profile"
                                >
                                    Profile
                                </Link>
                                <Link
                                    className={`rounded-lg px-3 py-2 text-caption text-workspace-muted no-underline hover:bg-workspace-primary-soft hover:text-workspace-primary-text ${focusRing}`}
                                    href="/app/settings/security"
                                >
                                    Security
                                </Link>
                                <Link
                                    className={`rounded-lg px-3 py-2 text-caption text-workspace-muted no-underline hover:bg-workspace-primary-soft hover:text-workspace-primary-text ${focusRing}`}
                                    href="/app/settings/notifications"
                                >
                                    Notifications
                                </Link>
                                <form method="post" action="/auth/logout">
                                    <button
                                        className={`w-full cursor-pointer rounded-lg border-0 bg-transparent px-3 py-2 text-left text-caption text-workspace-muted hover:bg-workspace-primary-soft hover:text-workspace-primary-text ${focusRing}`}
                                        type="submit"
                                    >
                                        Sign out
                                    </button>
                                </form>
                            </nav>
                        </details>
                    </div>
                </header>
                <section className="w-full px-8 pb-16 workspace-mobile:px-4 workspace-mobile:pb-12">
                    {children}
                </section>
            </section>
        </main>
    );
};
