"use client";

import Link from "next/link";
import { useState } from "react";

import type { ActivityTimelineItem } from "@/server/activity/reader";
import type { CrmCustomField, CrmOption, CrmResource } from "@/app/app/[teamSlug]/_crm-data";
import type { CrmRecordDetail } from "@/app/app/[teamSlug]/_record-data";

import { CrmIcon } from "./icon";
import { RecordEditForm, type CrmMutationAction } from "./record-edit-form";
import styles from "./crm.module.css";

const activitySummary = (item: ActivityTimelineItem): string => {
    if (item.event === "custom_field_changes") return "changed custom fields";
    if (item.event === "created") return "created this record";
    if (item.event === "deleted") return "moved this record to trash";
    if (item.event === "restored") return "restored this record";
    return "updated this record";
};

const formatDateTime = (value: string | null): string => value === null
    ? "Date unavailable"
    : new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

const valueLabel = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (Array.isArray(value)) return value.map(valueLabel).join(", ");
    if (typeof value === "object" && value !== null && "name" in value && typeof value.name === "string") return value.name;
    return "—";
};

export const RecordDetailPage = ({ action, activity, companies, customFields, detail, people, resource, teamSlug }: Readonly<{
    action: CrmMutationAction;
    activity: readonly ActivityTimelineItem[];
    companies: readonly CrmOption[];
    customFields: readonly CrmCustomField[];
    detail: CrmRecordDetail;
    people: readonly CrmOption[];
    resource: CrmResource;
    teamSlug: string;
}>) => {
    const [editing, setEditing] = useState(false);
    const [saved, setSaved] = useState(false);

    return (
        <>
            <header className={styles.header}>
                <div><h1>View {detail.title}</h1></div>
                <div className={styles.headerActions}><button className={styles.primaryAction} type="button" onClick={() => setEditing(true)}>✎ Edit</button><button className={styles.iconAction} type="button" aria-label="More actions"><CrmIcon name="dots" /></button></div>
            </header>
            {saved ? <p className={styles.success} role="status">Changes saved.</p> : null}
            <div className={styles.recordOverview}>
                <section className={styles.recordSummary} aria-label="Record details">
                    <div className={styles.recordIdentity}><span>{detail.title.slice(0, 2).toUpperCase()}</span><strong>{detail.title}</strong></div>
                    <dl>
                        <div><dt>Created By</dt><dd><span className={styles.miniAvatar}>A</span> Ada Lovelace</dd></div>
                        <div><dt>Account Owner</dt><dd>—</dd></div>
                        {customFields.map((field) => <div key={field.id}><dt>{field.name}</dt><dd>{valueLabel(detail.customValues[field.code])}</dd></div>)}
                    </dl>
                </section>
                <aside className={styles.recordDates}><div><strong>Created Date</strong><span>◷ {formatDateTime(detail.createdAt)}</span></div><div><strong>Last Updated</strong><span>◷ {formatDateTime(detail.updatedAt)}</span></div></aside>
            </div>
            <nav className={styles.relationTabs} aria-label="Record relationships">
                {resource === "companies" ? <Link href="#relationships">People</Link> : null}
                <Link href="#relationships">Tasks</Link><Link href="#relationships">Notes</Link><Link href="#activity">Activity log</Link>
            </nav>
            <section className={styles.activitySection} id="activity" aria-labelledby="activity-heading">
                <div className={styles.listHeader}><h2 id="activity-heading">Activity</h2><p>{activity.length} events</p></div>
                {activity.length === 0 ? <div className={styles.empty}><strong>No activity yet</strong><p>Changes to this record will appear here.</p></div> : <ol className={styles.timeline}>{activity.map((item) => <li key={item.id}><span aria-hidden="true" /><div><strong>{item.actor}</strong> {activitySummary(item)}<time dateTime={item.createdAt ?? undefined}>{formatDateTime(item.createdAt)}</time>{item.details.length === 0 ? null : <ul>{item.details.map((change) => <li key={change}>{change}</li>)}</ul>}</div></li>)}</ol>}
            </section>
            <p className={styles.backLink}><Link href={`/app/${teamSlug}/${resource}`}>Back to {resource}</Link></p>
            {editing ? <div className={styles.drawerBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(false); }}><section className={styles.drawer} role="dialog" aria-modal="true" aria-label={`Edit ${detail.title}`}><header className={styles.drawerHeader}><h2>Edit {detail.title}</h2><button type="button" aria-label="Close" onClick={() => setEditing(false)}>×</button></header><RecordEditForm action={action} companies={companies} customFields={customFields} detail={detail} onSuccess={() => { setEditing(false); setSaved(true); }} people={people} resource={resource} /></section></div> : null}
        </>
    );
};
