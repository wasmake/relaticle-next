"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

import type {
    CrmMutationState,
    CrmOption,
    CrmResource,
    CrmCustomField,
} from "@/app/app/[teamSlug]/_crm-data";

import { CustomFieldInputs } from "./custom-field-inputs";
import styles from "./crm.module.css";

const initialCrmMutationState: CrmMutationState = {
    status: "idle",
    message: "",
};

const singular = (resource: CrmResource): string =>
    resource === "people"
        ? "person"
        : resource.replace(/ies$/u, "y").replace(/s$/u, "");

export type CrmMutationAction = (
    state: CrmMutationState,
    formData: FormData,
) => Promise<CrmMutationState>;

const SubmitButton = ({ label }: Readonly<{ label: string }>) => {
    const { pending } = useFormStatus();

    return <button type="submit" disabled={pending}>{pending ? "Saving…" : label}</button>;
};

type CreateFormProperties = Readonly<{
    action: CrmMutationAction;
    resource: CrmResource;
    fieldLabel: string;
    companies: readonly CrmOption[];
    people: readonly CrmOption[];
    customFields: readonly CrmCustomField[];
    customFieldValues?: Readonly<Record<string, unknown>>;
    onSuccess?: () => void;
}>;

export const CreateForm = ({
    action,
    resource,
    fieldLabel,
    companies,
    people,
    customFields,
    customFieldValues,
    onSuccess,
}: CreateFormProperties) => {
    const [state, formAction] = useActionState(action, initialCrmMutationState);
    const showCompany = resource !== "companies";

    useEffect(() => {
        if (state.status === "success") onSuccess?.();
    }, [onSuccess, state.status]);

    return (
        <form action={formAction} className={styles.createForm}>
            <input type="hidden" name="intent" value="create" />
            <div className={styles.field}>
                <label htmlFor={`${resource}-value`}>{fieldLabel}</label>
                <input
                    id={`${resource}-value`}
                    name="value"
                    maxLength={255}
                    required
                    autoComplete="off"
                />
            </div>
            {showCompany ? (
                <div className={styles.field}>
                    <label htmlFor={`${resource}-company`}>Compan{resource === "tasks" || resource === "notes" ? "ies" : "y"} <span>optional</span></label>
                    <select id={`${resource}-company`} name={resource === "tasks" || resource === "notes" ? "company_ids" : "company_id"} multiple={resource === "tasks" || resource === "notes"} defaultValue={resource === "tasks" || resource === "notes" ? [] : ""}>
                        {resource === "tasks" || resource === "notes" ? null : <option value="">No company</option>}
                        {companies.map((company) => (
                            <option key={company.id} value={company.id}>{company.label}</option>
                        ))}
                    </select>
                </div>
            ) : null}
            {resource === "opportunities" ? (
                <div className={styles.field}>
                    <label htmlFor="opportunities-contact">Contact <span>optional</span></label>
                    <select id="opportunities-contact" name="contact_id" defaultValue="">
                        <option value="">No contact</option>
                        {people.map((person) => (
                            <option key={person.id} value={person.id}>{person.label}</option>
                        ))}
                    </select>
                </div>
            ) : null}
            <CustomFieldInputs fields={customFields} {...(customFieldValues === undefined ? {} : { values: customFieldValues })} />
            <div className={styles.formFooter}>
                <SubmitButton label={`Add ${singular(resource)}`} />
                {state.message !== "" ? (
                    <p className={state.status === "error" ? styles.error : styles.success} role="status">
                        {state.message}
                    </p>
                ) : null}
            </div>
        </form>
    );
};

export const DeleteForm = ({
    action,
    id,
    title,
}: Readonly<{ action: CrmMutationAction; id: string; title: string }>) => {
    const [, formAction] = useActionState(action, initialCrmMutationState);

    return (
        <form action={formAction}>
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="id" value={id} />
            <button className={styles.deleteButton} type="submit" aria-label={`Delete ${title}`}>
                ⋮
            </button>
        </form>
    );
};
