"use client";

import Link from "next/link";
import { useActionState } from "react";

import type { CrmMutationState, CrmResource } from "@/app/app/[teamSlug]/_crm-data";
import type { TrashRecord } from "@/server/browser-crm/service";

import type { CrmMutationAction } from "./mutation-form";
import styles from "./crm.module.css";

const initial: CrmMutationState = { status: "idle", message: "" };
const RestoreForm = ({ action, record }: { action: CrmMutationAction; record: TrashRecord }) => {
    const [state, formAction] = useActionState(action, initial);
    return <form action={formAction}><input type="hidden" name="intent" value="restore" /><input type="hidden" name="id" value={record.id} /><button type="submit">Restore</button>{state.message !== "" ? <span role="status">{state.message}</span> : null}</form>;
};

export const TrashPage = ({ action, records, resource, teamSlug }: Readonly<{ action: CrmMutationAction; records: readonly TrashRecord[]; resource: CrmResource; teamSlug: string }>) => <>
    <header className={styles.header}><div><p className={styles.eyebrow}>Recover records</p><h1>Trash</h1><p><Link href={`/app/${teamSlug}/${resource}`}>Back to {resource}</Link></p></div><span className={styles.total}>{records.length}</span></header>
    <section className={styles.panel}><h2>Deleted {resource}</h2>{records.length === 0 ? <div className={styles.empty}><strong>Trash is empty</strong></div> : <ul className={styles.recordList}>{records.map((record) => <li key={record.id}><div className={styles.recordMark}>{record.title.slice(0, 1)}</div><div className={styles.recordBody}><strong>{record.title}</strong><span>Deleted {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(record.deletedAt))}</span></div><RestoreForm action={action} record={record} /></li>)}</ul>}</section>
</>;
