import Link from "next/link";
import type { ReactNode } from "react";

import type { CrmCustomField, CrmPageData, CrmRecord } from "@/app/app/[teamSlug]/_crm-data";

import { CreateRecordDrawer } from "./create-record-drawer";
import { CsvControls } from "./csv-controls";
import { CrmIcon } from "./icon";
import { type CrmMutationAction, DeleteForm } from "./mutation-form";
import styles from "./crm.module.css";

type Column = Readonly<{
    key: string;
    label: string;
    sort?: "name" | "title" | "created_at" | "updated_at";
    value: (record: CrmRecord) => ReactNode;
}>;

const singular = (resource: CrmPageData["resource"]): string =>
    resource === "people" ? "person" : resource.replace(/ies$/u, "y").replace(/s$/u, "");

const dateLabel = (value: string | null): string => value === null
    ? "-"
    : new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(value));

const relativeLabel = (value: string | null): string => {
    if (value === null) return "-";
    const elapsed = Date.now() - new Date(value).getTime();
    const minutes = Math.max(0, Math.floor(elapsed / 60_000));
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return dateLabel(value);
};

const textList = (values: readonly string[]): ReactNode => values.length === 0
    ? <span className={styles.emptyValue}>-</span>
    : <span className={styles.valueList}>{values.map((value) => <span key={value}>{value}</span>)}</span>;

const customValueLabel = (value: unknown, field: CrmCustomField): ReactNode => {
    if (value === null || value === undefined || value === "") return <span className={styles.emptyValue}>-</span>;
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "number") return field.type === "currency" ? new Intl.NumberFormat("en", { style: "currency", currency: "USD" }).format(value) : value.toLocaleString("en");
    if (typeof value === "string") {
        if (field.type === "date" || field.type === "date-time") return dateLabel(value);
        return value;
    }
    if (Array.isArray(value)) return textList(value.map((item) => typeof item === "object" && item !== null && "label" in item ? String(item.label) : String(item)));
    if (typeof value === "object" && "label" in value) return <span className={styles.valueBadge}>{String(value.label)}</span>;
    return String(value);
};

const columnsFor = (data: CrmPageData, teamSlug: string): readonly Column[] => {
    const basePath = `/app/${teamSlug}/${data.resource}`;
    const primary: Column = {
        key: "title",
        label: singular(data.resource),
        sort: data.resource === "tasks" || data.resource === "notes" ? "title" : "name",
        value: (record) => <Link className={styles.recordTitle} href={`${basePath}/${record.id}`}><span>{record.title.slice(0, 2).toUpperCase()}</span>{record.title}</Link>,
    };
    const creator: Column = { key: "creator", label: "Created by", value: (record) => record.creator };
    const created: Column = { key: "created", label: "Creation date", sort: "created_at", value: (record) => dateLabel(record.createdAt) };
    const updated: Column = { key: "updated", label: "Last update", sort: "updated_at", value: (record) => relativeLabel(record.updatedAt) };
    const builtIn: readonly Column[] = data.resource === "companies"
        ? [primary, { key: "owner", label: "Account owner", value: (record) => record.accountOwner ?? <span className={styles.emptyValue}>-</span> }, creator, created, updated]
        : data.resource === "people"
            ? [primary, { key: "company", label: "Company", value: (record) => record.company === null ? <span className={styles.emptyValue}>-</span> : <Link className={styles.cellLink} href={`/app/${teamSlug}/companies/${record.company.id}`}>{record.company.label}</Link> }, creator]
            : data.resource === "opportunities"
                ? [primary, creator]
                : data.resource === "tasks"
                    ? [primary, creator]
                    : [primary, { key: "companies", label: "Companies", value: (record) => textList(record.companies) }, { key: "people", label: "People", value: (record) => textList(record.people) }, creator, created];
    const custom: readonly Column[] = data.customFields
        .filter(({ visibleInList }) => visibleInList)
        .map((field) => ({ key: field.id, label: field.name, value: (record) => customValueLabel(record.customFields[field.code], field) }));
    return [...builtIn, ...custom];
};

const pageUrl = (basePath: string, data: CrmPageData, updates: Readonly<Record<string, string | undefined>>): string => {
    const query = new URLSearchParams();
    if (data.search !== "") query.set("search", data.search);
    if (data.sort !== "-created_at") query.set("sort", data.sort);
    if (data.page > 1) query.set("page", data.page.toString());
    for (const [key, value] of Object.entries(updates)) {
        if (value === undefined) query.delete(key);
        else query.set(key, value);
    }
    const encoded = query.toString();
    return encoded === "" ? basePath : `${basePath}?${encoded}`;
};

export const ResourcePage = ({ action, data, teamSlug }: Readonly<{ action: CrmMutationAction; data: CrmPageData; teamSlug: string }>) => {
    const first = data.total === 0 ? 0 : (data.page - 1) * data.perPage + 1;
    const last = Math.min(data.page * data.perPage, data.total);
    const pageCount = Math.max(1, Math.ceil(data.total / data.perPage));
    const basePath = `/app/${teamSlug}/${data.resource}`;
    const columns = columnsFor(data, teamSlug);
    const sortUrl = (column: Column): string => {
        const field = column.sort;
        if (field === undefined) return "";
        const next = data.sort === field ? `-${field}` : field;
        return pageUrl(basePath, data, { page: undefined, sort: next });
    };

    return (
        <>
            <header className={styles.header}>
                <div><h1>{data.title}</h1>{data.resource === "opportunities" || data.resource === "tasks" ? <span className={styles.viewSwitcher}><strong>List</strong><Link href={`${basePath}/board`}>Board</Link></span> : null}</div>
                <div className={styles.headerActions}><CsvControls resource={data.resource} /><CreateRecordDrawer action={action} data={{ companies: data.companies, customFields: data.customFields, fieldLabel: data.fieldLabel, people: data.people, resource: data.resource }} /></div>
            </header>
            <section className={styles.tablePanel} aria-label={`${data.title} records`}>
                <div className={styles.tableToolbar}>
                    <form className={styles.tableSearch} action={basePath}><CrmIcon name="search" /><input aria-label={`Search ${data.title.toLowerCase()}`} name="search" defaultValue={data.search} placeholder="Search" /></form>
                    <details className={styles.filterMenu}><summary className={styles.iconAction} aria-label="Filter"><CrmIcon name="filter" /></summary><div><strong>Filters</strong>{data.resource === "tasks" ? <span>Assigned to me</span> : null}<span>Creation source</span><Link href={`${basePath}/trash`}>Trashed records</Link></div></details>
                </div>
                {data.records.length === 0 ? <div className={styles.empty}><strong>No {data.title.toLowerCase()} found</strong><p>{data.search === "" ? "Create the first record to get started." : "Try another search term."}</p></div> : (
                    <div className={styles.tableScroll}><table className={styles.recordTable}>
                        <thead><tr><th className={styles.selectionCell}><input type="checkbox" aria-label="Select all records" /></th>{columns.map((column) => <th key={column.key}>{column.sort === undefined ? column.label : <Link href={sortUrl(column)}>{column.label}<span>{data.sort === column.sort ? "↑" : data.sort === `-${column.sort}` ? "↓" : ""}</span></Link>}</th>)}<th aria-label="Actions" /></tr></thead>
                        <tbody>{data.records.map((record) => <tr key={record.id}><td className={styles.selectionCell}><input type="checkbox" aria-label={`Select ${record.title}`} /></td>{columns.map((column) => <td key={column.key}>{column.value(record)}</td>)}<td className={styles.rowActions}><DeleteForm action={action} id={record.id} title={record.title} /></td></tr>)}</tbody>
                    </table></div>
                )}
                <footer className={styles.listFooter}><span>Showing {first} to {last} of {data.total} results</span><nav className={styles.pagination} aria-label={`${data.title} pages`}>{data.page > 1 ? <Link href={pageUrl(basePath, data, { page: String(data.page - 1) })}>Previous</Link> : null}<strong>{data.page} / {pageCount}</strong>{data.page < pageCount ? <Link href={pageUrl(basePath, data, { page: String(data.page + 1) })}>Next</Link> : null}</nav></footer>
            </section>
        </>
    );
};
