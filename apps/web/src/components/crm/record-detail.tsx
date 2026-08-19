import Link from "next/link";

import type { ActivityTimelineItem } from "@/server/activity/reader";
import type { CrmCustomField, CrmOption, CrmResource } from "@/app/app/[teamSlug]/_crm-data";
import type { CrmRecordDetail } from "@/app/app/[teamSlug]/_record-data";

import { RecordEditForm, type CrmMutationAction } from "./record-edit-form";
import styles from "./crm.module.css";

const activitySummary = (item: ActivityTimelineItem): string => {
    if (item.event === "custom_field_changes") return "changed custom fields";
    if (item.event === "created") return "created this record";
    if (item.event === "deleted") return "moved this record to trash";
    if (item.event === "restored") return "restored this record";
    return "updated this record";
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
}>) => (
    <>
        <header className={styles.header}>
            <div><p className={styles.eyebrow}>Record detail</p><h1>{detail.title}</h1><p><Link href={`/app/${teamSlug}/${resource}`}>Back to {resource}</Link></p></div>
        </header>
        <section className={styles.panel} aria-labelledby="edit-record-heading">
            <h2 id="edit-record-heading">Edit record</h2>
            <RecordEditForm action={action} companies={companies} customFields={customFields} detail={detail} people={people} resource={resource} />
        </section>
        <section className={styles.listSection} aria-labelledby="activity-heading">
            <div className={styles.listHeader}><h2 id="activity-heading">Activity</h2><p>{activity.length} events</p></div>
            {activity.length === 0 ? <div className={styles.empty}><strong>No activity yet</strong><p>Changes to this record will appear here.</p></div> : (
                <ol className={styles.timeline}>{activity.map((item) => <li key={item.id}><span aria-hidden="true" /><div><strong>{item.actor}</strong> {activitySummary(item)}<time dateTime={item.createdAt ?? undefined}>{item.createdAt === null ? "Date unavailable" : new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}</time>{item.details.length === 0 ? null : <ul>{item.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>}</div></li>)}</ol>
            )}
        </section>
    </>
);
