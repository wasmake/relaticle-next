"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { AdminResource } from "@/server/sysadmin/resources";

import styles from "./admin.module.css";

const display = (value: unknown, type: AdminResource["fields"][number]["type"]): string => {
    if (value === null || value === undefined) return "";
    if (type === "datetime" && typeof value === "string") return value.slice(0, 16);
    if (type === "json") return JSON.stringify(value, null, 2);
    return String(value);
};

export const ResourceEditor = ({ resource, record }: Readonly<{ resource: AdminResource; record?: Record<string, unknown> }>) => {
    const router = useRouter();
    const [error, setError] = useState<string>();
    const [saving, setSaving] = useState(false);
    const endpoint = record === undefined ? `/sysadmin/api/resources/${resource.slug}` : `/sysadmin/api/resources/${resource.slug}/${String(record[resource.id])}`;

    const submit = async (form: FormData) => {
        setSaving(true); setError(undefined);
        const body = Object.fromEntries(resource.fields.map((field) => {
            if (field.type === "boolean") return [field.column, form.get(field.column) === "true"];
            return [field.column, form.get(field.column)];
        }));
        const response = await fetch(endpoint, { method: record === undefined ? "POST" : "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const payload = await response.json().catch(() => ({})) as { data?: Record<string, unknown>; message?: string };
        setSaving(false);
        if (!response.ok) { setError(payload.message ?? "The record could not be saved."); return; }
        if (record === undefined && payload.data !== undefined) router.push(`/sysadmin/${resource.slug}/${String(payload.data[resource.id])}`);
        else router.refresh();
    };

    const remove = async () => {
        if (record === undefined || !window.confirm("Delete this record? This cannot always be undone.")) return;
        const response = await fetch(endpoint, { method: "DELETE" });
        if (response.ok) router.push(`/sysadmin/${resource.slug}`);
        else setError("The record could not be deleted.");
    };

    const preview = async () => {
        if (record === undefined) return;
        const response = await fetch(`/sysadmin/api/blog-preview?slug=${encodeURIComponent(String(record.slug))}`);
        const payload = await response.json() as { url?: string; message?: string };
        if (payload.url !== undefined) window.open(payload.url, "_blank", "noopener,noreferrer");
        else setError(payload.message ?? "Could not create preview.");
    };

    return <form className={styles.form} action={submit}>
        {error === undefined ? null : <p className={styles.error} role="alert">{error}</p>}
        {resource.fields.map((field) => <div className={`${styles.field} ${field.type === "textarea" || field.type === "json" ? styles.fieldWide : ""}`} key={field.column}>
            <label htmlFor={field.column}>{field.label}</label>
            {field.type === "textarea" || field.type === "json" ? <textarea id={field.column} name={field.column} defaultValue={display(record?.[field.column] ?? field.defaultValue, field.type)} required={field.required} /> : field.type === "boolean" ? <select id={field.column} name={field.column} defaultValue={display(record?.[field.column] ?? field.defaultValue ?? false, field.type)}><option value="false">No</option><option value="true">Yes</option></select> : <input id={field.column} name={field.column} type={field.type === "datetime" ? "datetime-local" : field.type ?? "text"} defaultValue={field.type === "password" ? "" : display(record?.[field.column] ?? field.defaultValue, field.type)} required={field.required === true && record === undefined} />}
        </div>)}
        <div className={styles.actions}>
            <button className={styles.button} disabled={saving} type="submit">{saving ? "Saving..." : "Save record"}</button>
            {resource.slug === "blog-posts" && record !== undefined ? <button className={styles.button} type="button" onClick={preview}>Signed preview</button> : null}
            {record === undefined ? null : <button className={styles.danger} type="button" onClick={remove}>Delete</button>}
        </div>
    </form>;
};
