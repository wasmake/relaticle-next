import type { CustomFieldMetadataPage, CustomFieldMetadataRecord } from "./types";

const date = (value: Date | null): string | null =>
    value === null ? null : value.toISOString().replace(/Z$/u, "000Z");

const resource = (field: CustomFieldMetadataRecord) => ({
    id: field.id,
    type: "custom-fields",
    attributes: {
        custom_field_section_id: field.sectionId,
        code: field.code,
        name: field.name,
        type: field.type,
        lookup_type: field.lookupType,
        entity_type: field.entityType,
        sort_order: field.sortOrder === null ? null : Number(field.sortOrder),
        validation_rules: field.validationRules,
        active: field.active,
        system_defined: field.systemDefined,
        settings: field.settings,
        options: field.options.map((option) => ({
            id: option.id,
            name: option.name,
            sort_order: option.sortOrder === null ? null : Number(option.sortOrder),
            settings: option.settings,
        })),
        created_at: date(field.createdAt),
        updated_at: date(field.updatedAt),
    },
});

const pageUrl = (requestUrl: URL, page: number): string => {
    const url = new URL(requestUrl);
    url.searchParams.set("page", String(page));
    return url.toString();
};

export const customFieldMetadataDocument = (
    result: CustomFieldMetadataPage,
    requestUrl: URL,
): unknown => {
    const lastPage = Math.max(1, Math.ceil(result.total / result.perPage));
    const offset = (result.page - 1) * result.perPage;
    const count = result.records.length;

    return {
        data: result.records.map(resource),
        links: {
            first: pageUrl(requestUrl, 1),
            last: pageUrl(requestUrl, lastPage),
            prev: result.page > 1 ? pageUrl(requestUrl, result.page - 1) : null,
            next: result.page < lastPage ? pageUrl(requestUrl, result.page + 1) : null,
        },
        meta: {
            current_page: result.page,
            from: count === 0 ? null : offset + 1,
            last_page: lastPage,
            path: `${requestUrl.origin}${requestUrl.pathname}`,
            per_page: result.perPage,
            to: count === 0 ? null : offset + count,
            total: result.total,
        },
    };
};
