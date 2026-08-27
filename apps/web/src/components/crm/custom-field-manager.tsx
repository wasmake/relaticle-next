"use client";

import { useActionState, useState } from "react";

import type { FieldSettingsState } from "@/app/app/[teamSlug]/settings/custom-fields/actions";
import { customFieldEntityTypes, customFieldTypes } from "@/server/custom-fields/types";

import { CrmIcon } from "./icon";
import styles from "./crm.module.css";

type Section = Readonly<{ id: string; name: string; entityType: string; active: boolean; systemDefined: boolean }>;
type Field = Readonly<{ id: string; sectionId: string | null; name: string; code: string; type: string; entityType: string; active: boolean; systemDefined: boolean; required: boolean; minimum: string; maximum: string; options: readonly string[] }>;
type Action = (state: FieldSettingsState, data: FormData) => Promise<FieldSettingsState>;
type FormAction = (data: FormData) => void;
const initial: FieldSettingsState = { status: "idle", message: "" };

const labels: Record<string, string> = { company: "Companies", people: "People", opportunity: "Opportunities", task: "Tasks", note: "Notes" };

const FieldForm = ({ action, entity, field, sections }: { action: FormAction; entity: string; field?: Field; sections: readonly Section[] }) => (
    <details className={styles.fieldEditor}>
        <summary>{field?.name ?? "Add Field"}</summary>
        <form action={action} className={styles.settingsForm}>
            <input type="hidden" name="intent" value="field" /><input type="hidden" name="id" value={field?.id ?? ""} />
            <label>Name<input name="name" required defaultValue={field?.name} /></label>
            <label>Code<input name="code" defaultValue={field?.code} placeholder="generated_from_name" /></label>
            <label>Record type<select name="entity_type" defaultValue={field?.entityType ?? entity}>{customFieldEntityTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
            <label>Input type<select name="type" defaultValue={field?.type ?? "text"}>{customFieldTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
            <label>Section<select name="section_id" defaultValue={field?.sectionId ?? ""}><option value="">No section</option>{sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</select></label>
            <label className={styles.checkboxLabel}><input type="checkbox" name="required" value="true" defaultChecked={field?.required} /> Required</label>
            <label>Minimum<input name="minimum" type="number" defaultValue={field?.minimum} /></label>
            <label>Maximum<input name="maximum" type="number" defaultValue={field?.maximum} /></label>
            <label className={styles.wideField}>Options, one per line<textarea name="options" defaultValue={field?.options.join("\n")} /></label>
            <button type="submit">Save field</button>
        </form>
    </details>
);

export const CustomFieldManager = ({ action, canManage, fields, sections }: Readonly<{ action: Action; canManage: boolean; fields: readonly Field[]; sections: readonly Section[] }>) => {
    const [state, formAction] = useActionState(action, initial);
    const [entity, setEntity] = useState<string>(customFieldEntityTypes.includes("opportunity") ? "opportunity" : customFieldEntityTypes[0] ?? "company");
    const visibleFields = fields.filter((field) => field.entityType === entity);

    if (!canManage) return <section className={styles.panel}><h2>Administrator access required</h2><p>Only workspace owners and administrators can change field definitions.</p></section>;

    return (
        <div className={styles.fieldsLayout}>
            <aside className={styles.fieldsSidebar} aria-label="Record types">
                {customFieldEntityTypes.map((type) => <button key={type} type="button" data-active={entity === type} onClick={() => setEntity(type)}><CrmIcon name={type === "company" ? "building" : type === "people" ? "people" : type === "opportunity" ? "trophy" : type === "task" ? "task" : "note"} /><span>{labels[type] ?? type}</span><small>{fields.filter((field) => field.entityType === type).length}</small></button>)}
            </aside>
            <section className={styles.fieldsMain}>
                <div className={styles.fieldsToolbar}><div className={styles.tableSearch}><CrmIcon name="search" /><span>Search fields...</span></div><FieldForm key={entity} action={formAction} entity={entity} sections={sections.filter((section) => section.entityType === entity)} /></div>
                {state.message === "" ? null : <p role="status" className={state.status === "error" ? styles.error : styles.success}>{state.message}</p>}
                <div className={styles.fieldsTable}>
                    <header><strong>Name</strong><strong>Type</strong><strong>Constraints</strong><strong>Properties</strong><span /></header>
                    {visibleFields.map((field) => <div key={field.id}><span>⠿</span><strong>{field.name}</strong><span>{field.type.replaceAll("_", " ")}</span><span>{field.required ? "Required" : ""}</span><span>{field.systemDefined ? "System" : "Custom"}</span><FieldForm action={formAction} entity={entity} field={field} sections={sections.filter((section) => section.entityType === entity)} /></div>)}
                    {visibleFields.length === 0 ? <p>No fields for this record type.</p> : null}
                </div>
                <details className={styles.sectionManager}><summary>Manage sections</summary><form action={formAction} className={styles.inlineSettings}><input type="hidden" name="intent" value="section" /><input name="name" aria-label="Section name" placeholder="Section name" required /><input type="hidden" name="entity_type" value={entity} /><button type="submit">Add section</button></form>{sections.filter((section) => section.entityType === entity).map((section) => <form key={section.id} action={formAction} className={styles.inlineSettings}><input type="hidden" name="intent" value="section" /><input type="hidden" name="id" value={section.id} /><input name="name" aria-label={`Name for ${section.name}`} defaultValue={section.name} required /><input type="hidden" name="entity_type" value={entity} /><button type="submit">Save</button></form>)}</details>
            </section>
        </div>
    );
};
