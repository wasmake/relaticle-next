import Link from "next/link";

import type { CrmPageData } from "@/app/app/[teamSlug]/_crm-data";

import { CsvControls } from "./csv-controls";
import { CreateForm, type CrmMutationAction, DeleteForm } from "./mutation-form";
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
                    <p className={styles.eyebrow}>Workspace records</p>
                    <h1>{data.title}</h1>
                    {data.resource === "opportunities" || data.resource === "tasks" ? <p><strong>List</strong> · <Link href={`${basePath}/board`}>Board</Link></p> : null}
                    <p>{data.description}</p>
                </div>
                <span className={styles.total}>{data.total}</span>
            </header>
            <CsvControls resource={data.resource} />
            <section className={styles.panel} aria-labelledby="create-heading">
                <h2 id="create-heading">Add a {singular(data.resource)}</h2>
                <CreateForm
                    action={action}
                    resource={data.resource}
                    fieldLabel={data.fieldLabel}
                    companies={data.companies}
                    people={data.people}
                    customFields={data.customFields}
                />
            </section>
            <section className={styles.listSection} aria-labelledby="records-heading">
                <div className={styles.listHeader}>
                    <h2 id="records-heading">All {data.title.toLowerCase()}</h2>
                    <p>{first}–{last} of {data.total}</p>
                </div>
                {data.records.length === 0 ? (
                    <div className={styles.empty}>
                        <strong>No {data.title.toLowerCase()} yet</strong>
                        <p>Add the first one above to start building your team&apos;s shared context.</p>
                    </div>
                ) : (
                    <ul className={styles.recordList}>
                        {data.records.map((record) => (
                            <li key={record.id}>
                                <div className={styles.recordMark} aria-hidden="true">
                                    {record.title.slice(0, 1).toUpperCase()}
                                </div>
                                <Link className={styles.recordBody} href={`${basePath}/${record.id}`}>
                                    <strong>{record.title}</strong>
                                    <span>{record.detail}</span>
                                </Link>
                                <time dateTime={record.createdAt ?? undefined}>{dateLabel(record.createdAt)}</time>
                                <DeleteForm action={action} id={record.id} title={record.title} />
                            </li>
                        ))}
                    </ul>
                )}
                {pageCount > 1 ? (
                    <nav className={styles.pagination} aria-label={`${data.title} pages`}>
                        {data.page > 1 ? <Link href={`${basePath}?page=${data.page - 1}`}>Previous</Link> : <span>Previous</span>}
                        <strong>Page {data.page} of {pageCount}</strong>
                        {data.page < pageCount ? <Link href={`${basePath}?page=${data.page + 1}`}>Next</Link> : <span>Next</span>}
                    </nav>
                ) : null}
                <p className={styles.trashLink}><Link href={`${basePath}/trash`}>View trash</Link></p>
            </section>
        </>
    );
};
