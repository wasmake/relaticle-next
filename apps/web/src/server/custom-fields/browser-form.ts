export const customFieldsFromFormData = (formData: FormData): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const [name] of formData.entries()) {
        if (!name.startsWith("custom_field.")) continue;
        const code = name.slice("custom_field.".length);
        const typeValue = formData.get(`custom_type.${code}`);
        const type = typeof typeValue === "string" ? typeValue : "";
        const values = formData.getAll(name).filter((value): value is string => typeof value === "string");
        const listType = ["email", "phone", "link", "tags-input", "record"].includes(type);
        const value = listType
            ? values.flatMap((item) => item.split("\n")).map((item) => item.trim()).filter(Boolean)
            : values.length > 1 ? values : (values[0] ?? "");
        result[code] = type === "checkbox" || type === "toggle" ? values.includes("true") : value;
    }
    return result;
};
