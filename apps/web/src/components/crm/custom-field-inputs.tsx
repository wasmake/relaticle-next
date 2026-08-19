import type { CrmCustomField } from "@/app/app/[teamSlug]/_crm-data";

import styles from "./crm.module.css";

const scalarValue = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (typeof value === "object" && value !== null && "id" in value && typeof value.id === "string") return value.id;
    return "";
};

const listValue = (value: unknown): readonly string[] => Array.isArray(value)
    ? value.map(scalarValue).filter(Boolean)
    : [];

const listTextValue = (value: unknown): string => listValue(value).join("\n");

const htmlType = (type: string): "text" | "number" | "email" | "url" | "date" | "datetime-local" | "color" => {
    if (type === "number" || type === "currency") return "number";
    if (type === "email") return "email";
    if (type === "link") return "url";
    if (type === "date") return "date";
    if (type === "date-time") return "datetime-local";
    if (type === "color-picker") return "color";
    return "text";
};

export const CustomFieldInputs = ({ fields, values = {} }: Readonly<{ fields: readonly CrmCustomField[]; values?: Readonly<Record<string, unknown>> }>) => (
    <>
        {fields.map((field) => {
            const id = `custom-${field.id}`;
            const name = `custom_field.${field.code}`;
            const value = values[field.code];
            const multiple = ["multi-select", "checkbox-list"].includes(field.type);
            const choices = ["select", "radio", "toggle-buttons", "multi-select", "checkbox-list"].includes(field.type);
            return (
                <div className={styles.field} key={field.id}>
                    <input type="hidden" name={`custom_type.${field.code}`} value={field.type} />
                    <label htmlFor={id}>{field.name}{field.required ? null : <span> optional</span>}</label>
                    {choices ? (
                        <select id={id} name={name} required={field.required} multiple={multiple} defaultValue={multiple ? [...listValue(value)] : scalarValue(value)}>
                            {!multiple ? <option value="">Select an option</option> : null}
                            {field.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                        </select>
                    ) : ["textarea", "rich-editor", "markdown-editor", "email", "phone", "link", "tags-input", "record"].includes(field.type) ? (
                        <textarea id={id} name={name} required={field.required} defaultValue={["email", "phone", "link", "tags-input", "record"].includes(field.type) ? listTextValue(value) : scalarValue(value)} />
                    ) : field.type === "checkbox" || field.type === "toggle" ? (
                        <span className={styles.checkField}><input type="hidden" name={name} value="false" /><input id={id} name={name} type="checkbox" value="true" defaultChecked={value === true} /> Enabled</span>
                    ) : field.type === "file-upload" ? (
                        <>
                            {typeof value === "string" && value !== "" ? <><input type="hidden" name={name} value={value} /><a href={`/api/v1/media/${value}`}>Download current file</a></> : null}
                            <input id={id} name={`custom_file.${field.code}`} type="file" required={field.required && !(typeof value === "string" && value !== "")} />
                        </>
                    ) : (
                        <input id={id} name={name} type={htmlType(field.type)} step={field.type === "number" || field.type === "currency" ? "any" : undefined} required={field.required} defaultValue={scalarValue(value)} />
                    )}
                </div>
            );
        })}
    </>
);
