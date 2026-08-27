"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

import type { CrmCustomField, CrmMutationState, CrmOption, CrmResource } from "@/app/app/[teamSlug]/_crm-data";
import type { CrmRecordDetail } from "@/app/app/[teamSlug]/_record-data";

import { CustomFieldInputs } from "./custom-field-inputs";
import styles from "./crm.module.css";

export type CrmMutationAction = (state: CrmMutationState, data: FormData) => Promise<CrmMutationState>;
const initial: CrmMutationState = { status: "idle", message: "" };

const SaveButton = () => {
    const { pending } = useFormStatus();
    return <button type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</button>;
};

export const RecordEditForm = ({ action, companies, customFields, detail, onSuccess, people, resource }: Readonly<{ action: CrmMutationAction; companies: readonly CrmOption[]; customFields: readonly CrmCustomField[]; detail: CrmRecordDetail; onSuccess?: () => void; people: readonly CrmOption[]; resource: CrmResource }>) => {
    const [state, formAction] = useActionState(action, initial);
    useEffect(() => { if (state.status === "success") onSuccess?.(); }, [onSuccess, state.status]);
    return <form action={formAction} className={styles.createForm}>
        <input type="hidden" name="intent" value="update" /><input type="hidden" name="id" value={detail.id} />
        <div className={styles.field}><label htmlFor="record-value">{resource === "tasks" || resource === "notes" ? "Title" : "Name"}</label><input id="record-value" name="value" required maxLength={255} defaultValue={detail.title} /></div>
        {resource !== "companies" ? <div className={styles.field}><label htmlFor="record-company">Compan{resource === "tasks" || resource === "notes" ? "ies" : "y"} <span>optional</span></label><select id="record-company" name={resource === "tasks" || resource === "notes" ? "company_ids" : "company_id"} multiple={resource === "tasks" || resource === "notes"} defaultValue={resource === "tasks" || resource === "notes" ? [...detail.companyIds] : detail.companyId ?? ""}>{resource === "tasks" || resource === "notes" ? null : <option value="">No company</option>}{companies.map((company) => <option key={company.id} value={company.id}>{company.label}</option>)}</select></div> : null}
        {resource === "opportunities" ? <div className={styles.field}><label htmlFor="record-contact">Contact <span>optional</span></label><select id="record-contact" name="contact_id" defaultValue={detail.contactId ?? ""}><option value="">No contact</option>{people.map((person) => <option key={person.id} value={person.id}>{person.label}</option>)}</select></div> : null}
        <CustomFieldInputs fields={customFields} values={detail.customValues} />
        <div className={styles.formFooter}><SaveButton />{state.message !== "" ? <p role="status" className={state.status === "error" ? styles.error : styles.success}>{state.message}</p> : null}</div>
    </form>;
};
