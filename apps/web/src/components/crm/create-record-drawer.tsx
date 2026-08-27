"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { CrmPageData } from "@/app/app/[teamSlug]/_crm-data";

import { CrmIcon } from "./icon";
import { CreateForm, type CrmMutationAction } from "./mutation-form";
import styles from "./crm.module.css";

type CreateRecordData = Pick<CrmPageData, "companies" | "customFields" | "fieldLabel" | "people" | "resource">;

const singular = (resource: CreateRecordData["resource"]): string =>
    resource === "people" ? "person" : resource.replace(/ies$/u, "y").replace(/s$/u, "");

export const CreateRecordDrawer = ({ action, compact = false, customFieldValues, data, triggerLabel }: Readonly<{
    action: CrmMutationAction;
    compact?: boolean;
    customFieldValues?: Readonly<Record<string, unknown>>;
    data: CreateRecordData;
    triggerLabel?: string;
}>) => {
    const [open, setOpen] = useState(false);
    const [message, setMessage] = useState("");
    const router = useRouter();
    const noun = singular(data.resource);

    return (
        <>
            <button className={compact ? styles.compactCreateAction : styles.primaryAction} type="button" aria-label={triggerLabel} onClick={() => setOpen(true)}><CrmIcon name="plus" />{compact ? null : <> New {noun}</>}</button>
            {message === "" ? null : <p className={styles.success} role="status">{message}</p>}
            {open ? (
                <div className={styles.drawerBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
                    <section className={styles.drawer} role="dialog" aria-modal="true" aria-label={`New ${noun}`}>
                        <header className={styles.drawerHeader}><h2>New {noun}</h2><button type="button" aria-label="Close" onClick={() => setOpen(false)}>×</button></header>
                        <CreateForm
                            action={action}
                            resource={data.resource}
                            fieldLabel={data.fieldLabel}
                            companies={data.companies}
                            people={data.people}
                            customFields={data.customFields}
                            {...(customFieldValues === undefined ? {} : { customFieldValues })}
                            onSuccess={() => {
                                setMessage("Record created.");
                                setOpen(false);
                                router.refresh();
                            }}
                        />
                    </section>
                </div>
            ) : null}
        </>
    );
};
