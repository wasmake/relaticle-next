import Link from "next/link";

import type { CrmPageData } from "@/app/app/[teamSlug]/_crm-data";

import { CreateRecordDrawer } from "./create-record-drawer";
import { CrmIcon } from "./icon";
import { type CrmMutationAction, DeleteForm } from "./mutation-form";
import styles from "./crm.module.css";

const singular = (resource: CrmPageData["resource"]): string =>
    resource === "people"
        ? "person"
        : resource.replace(/ies$/u, "y").replace(/s$/u, "");

const dateLabel = (value: string | null): string => {
    if (value === null) {
        return "Date unavailable";
    }

    return new Intl.DateTimeFormat("en", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
    }).format(new Date(value));
};

export const ResourcePage = ({
    action,
    data,
    teamSlug,
}: Readonly<{
    action: CrmMutationAction;
    data: CrmPageData;
    teamSlug: string;
}>) => {
    const first = data.total === 0 ? 0 : (data.page - 1) * data.perPage + 1;
    const last = Math.min(data.page * data.perPage, data.total);
    const pageCount = Math.max(1, Math.ceil(data.total / data.perPage));
    const basePath = `/app/${teamSlug}/${data.resource}`;

    return (
        <>
            <header className={styles.header}>
                <div>
                    <h1>{data.title}</h1>
                    {data.resource === "opportunities" || data.resource === "tasks" ? <span className={styles.viewSwitcher}><strong>List</strong><Link href={`${basePath}/board`}>Board</Link></span> : null}
                </div>
                <div className={styles.headerActions}>
                    <Link className={styles.secondaryAction} href={`${basePath}?import=1`}>↕ Import / Export</Link>
                    <CreateRecordDrawer action={action} data={data} />
                </div>
            </header>
            <section className={styles.tablePanel} aria-label={`${data.title} records`}>
                <div className={styles.tableToolbar}><div className={styles.tableSearch}><CrmIcon name="search" /><span>Search</span></div><button className={styles.iconAction} type="button" aria-label="Filter"><CrmIcon name="filter" /></button></div>
                {data.records.length === 0 ? (
                    <div className={styles.empty}>
                        <strong>No {data.title.toLowerCase()} yet</strong>
                        <p>Create the first record to get started.</p>
                    </div>
                ) : (
                    <table className={styles.recordTable}>
                        <thead><tr><th className={styles.selectionCell}><input type="checkbox" aria-label="Select all records" /></th><th>{singular(data.resource)}</th><th>Related records</th><th>Created by</th><th>Creation date</th><th>Last update</th><th aria-label="Actions" /></tr></thead>
                        <tbody>{data.records.map((record) => <tr key={record.id}><td className={styles.selectionCell}><input type="checkbox" aria-label={`Select ${record.title}`} /></td><td><Link className={styles.recordTitle} href={`${basePath}/${record.id}`}><span>{record.title.slice(0, 2).toUpperCase()}</span>{record.title}</Link></td><td className={styles.mutedCell}>{record.detail}</td><td>System</td><td>{dateLabel(record.createdAt)}</td><td className={styles.mutedCell}>{dateLabel(record.createdAt)}</td><td className={styles.rowActions}><DeleteForm action={action} id={record.id} title={record.title} /></td></tr>)}</tbody>
                    </table>
                )}
                <footer className={styles.listFooter}><span>Showing {first} to {last} of {data.total} results</span><nav className={styles.pagination} aria-label={`${data.title} pages`}>{data.page > 1 ? <Link href={`${basePath}?page=${data.page - 1}`}>Previous</Link> : null}<strong>{data.page} / {pageCount}</strong>{data.page < pageCount ? <Link href={`${basePath}?page=${data.page + 1}`}>Next</Link> : null}</nav><p className={styles.trashLink}><Link href={`${basePath}/trash`}>View trash</Link></p></footer>
            </section>
        </>
    );
};
