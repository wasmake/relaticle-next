import { randomUUID } from "node:crypto";

import { hash } from "bcryptjs";
import { ulid } from "ulidx";

import { getSqlClient } from "@/server/db/client";

export type AdminField = Readonly<{
    column: string;
    label: string;
    type?: "text" | "email" | "number" | "boolean" | "datetime" | "textarea" | "json" | "password";
    required?: boolean;
    virtual?: boolean;
    defaultValue?: string | number | boolean;
}>;
export type AdminResource = Readonly<{
    slug: string;
    label: string;
    table: string;
    id: string;
    title: string;
    idKind: "ulid" | "serial" | "uuid";
    fields: readonly AdminField[];
    softDelete?: boolean;
}>;

const field = (column: string, label: string, options: Omit<AdminField, "column" | "label"> = {}): AdminField => ({ column, label, ...options });
const resources: readonly AdminResource[] = [
    { slug: "users", label: "Users", table: "users", id: "id", title: "name", idKind: "ulid", fields: [field("name", "Name", { required: true }), field("email", "Email", { type: "email", required: true }), field("timezone", "Timezone")] },
    { slug: "teams", label: "Teams", table: "teams", id: "id", title: "name", idKind: "ulid", fields: [field("user_id", "Owner ID", { required: true }), field("name", "Name", { required: true }), field("slug", "Slug", { required: true }), field("personal_team", "Personal team", { type: "boolean" }), field("plan", "Plan", { defaultValue: "free", required: true })] },
    ...["companies", "people", "opportunities"].map((slug): AdminResource => ({ slug, label: slug[0]?.toUpperCase() + slug.slice(1), table: slug, id: "id", title: "name", idKind: "ulid", softDelete: true, fields: [field("team_id", "Team ID", { required: true }), field("name", "Name", { required: true }), field("creation_source", "Creation source", { required: true, defaultValue: "system" })] })),
    ...["tasks", "notes"].map((slug): AdminResource => ({ slug, label: slug[0]?.toUpperCase() + slug.slice(1), table: slug, id: "id", title: "title", idKind: "ulid", softDelete: true, fields: [field("team_id", "Team ID", { required: true }), field("title", "Title", { required: true }), field("creation_source", "Creation source", { required: true, defaultValue: "system" })] })),
    { slug: "imports", label: "Imports", table: "imports", id: "id", title: "file_name", idKind: "ulid", fields: [field("team_id", "Team ID"), field("user_id", "User ID", { required: true }), field("file_name", "File name", { required: true }), field("entity_type", "Entity type"), field("status", "Status", { required: true, defaultValue: "uploading" }), field("total_rows", "Total rows", { type: "number", required: true })] },
    { slug: "activity", label: "Activity", table: "activity_log", id: "id", title: "description", idKind: "serial", fields: [field("team_id", "Team ID"), field("description", "Description", { type: "textarea", required: true }), field("event", "Event"), field("subject_type", "Subject type"), field("subject_id", "Subject ID"), field("properties", "Properties", { type: "json" })] },
    { slug: "subscriptions", label: "Subscriptions", table: "subscriptions", id: "id", title: "stripe_id", idKind: "serial", fields: [field("team_id", "Team ID", { required: true }), field("type", "Type", { required: true }), field("stripe_id", "Stripe ID", { required: true }), field("stripe_status", "Status", { required: true }), field("stripe_price", "Price")] },
    { slug: "ai-conversations", label: "AI conversations", table: "agent_conversations", id: "id", title: "title", idKind: "uuid", fields: [field("team_id", "Team ID"), field("participant_id", "Participant ID"), field("participant_type", "Participant type"), field("title", "Title", { required: true })] },
    { slug: "ai-messages", label: "AI messages", table: "agent_conversation_messages", id: "id", title: "content", idKind: "uuid", fields: [field("conversation_id", "Conversation ID", { required: true }), field("participant_id", "Participant ID"), field("agent", "Agent", { required: true }), field("role", "Role", { required: true }), field("content", "Content", { type: "textarea", required: true }), field("attachments", "Attachments", { type: "json" }), field("tool_calls", "Tool calls", { type: "json" }), field("tool_results", "Tool results", { type: "json" }), field("usage", "Usage", { type: "json" }), field("meta", "Meta", { type: "json" })] },
    { slug: "ai-feedback", label: "AI feedback", table: "chat_message_feedback", id: "id", title: "rating", idKind: "ulid", fields: [field("team_id", "Team ID", { required: true }), field("user_id", "User ID", { required: true }), field("conversation_id", "Conversation ID", { required: true }), field("message_id", "Message ID", { required: true }), field("rating", "Rating", { required: true }), field("category", "Category"), field("comment", "Comment", { type: "textarea" }), field("model", "Model")] },
    { slug: "ai-credits", label: "AI credit balances", table: "ai_credit_balances", id: "id", title: "team_id", idKind: "ulid", fields: [field("team_id", "Team ID", { required: true }), field("credits_remaining", "Credits remaining", { type: "number", defaultValue: 0 }), field("credits_used", "Credits used", { type: "number", defaultValue: 0 }), field("purchased_credits", "Purchased credits", { type: "number", defaultValue: 0 }), field("period_starts_at", "Period starts", { type: "datetime", required: true }), field("period_ends_at", "Period ends", { type: "datetime", required: true })] },
    { slug: "ai-credit-transactions", label: "AI credit transactions", table: "ai_credit_transactions", id: "id", title: "idempotency_key", idKind: "ulid", fields: [field("team_id", "Team ID", { required: true }), field("user_id", "User ID"), field("conversation_id", "Conversation ID"), field("idempotency_key", "Idempotency key", { required: true }), field("type", "Type", { required: true }), field("model", "Model", { required: true }), field("input_tokens", "Input tokens", { type: "number", defaultValue: 0 }), field("output_tokens", "Output tokens", { type: "number", defaultValue: 0 }), field("credits_charged", "Credits charged", { type: "number", defaultValue: 0 })] },
    { slug: "system-administrators", label: "System administrators", table: "system_administrators", id: "id", title: "name", idKind: "ulid", fields: [field("name", "Name", { required: true }), field("email", "Email", { type: "email", required: true }), field("role", "Role", { required: true }), field("password", "Password", { type: "password", required: true })] },
    { slug: "blog-posts", label: "Blog posts", table: "blog_posts", id: "id", title: "title", idKind: "serial", softDelete: true, fields: [field("title", "Title", { required: true }), field("slug", "Slug", { required: true }), field("content", "Markdown", { type: "textarea", required: true }), field("excerpt", "Excerpt", { type: "textarea" }), field("featured_image", "Featured image URL"), field("category_id", "Category ID", { type: "number" }), field("author_id", "Author ID"), field("status", "Status", { required: true, defaultValue: "draft" }), field("published_at", "Published at", { type: "datetime" }), field("tag_ids", "Tag IDs (comma separated)", { virtual: true }), field("seo_title", "SEO title", { virtual: true }), field("seo_description", "SEO description", { type: "textarea", virtual: true }), field("seo_image", "SEO image URL", { virtual: true }), field("canonical_url", "Canonical URL", { virtual: true }), field("robots", "Robots", { virtual: true })] },
    { slug: "blog-categories", label: "Blog categories", table: "blog_categories", id: "id", title: "name", idKind: "serial", softDelete: true, fields: [field("name", "Name", { required: true }), field("slug", "Slug", { required: true })] },
    { slug: "blog-tags", label: "Blog tags", table: "blog_tags", id: "id", title: "name", idKind: "serial", softDelete: true, fields: [field("name", "Name", { required: true }), field("slug", "Slug", { required: true })] },
];

export const adminResources = resources;
export const getAdminResource = (slug: string): AdminResource | undefined => resources.find((resource) => resource.slug === slug);

const normalize = (value: unknown): unknown => {
    if (typeof value === "bigint") return value.toString();
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(normalize);
    if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
    return value;
};
export const serializeAdminRecord = (resource: AdminResource, row: Record<string, unknown>): Record<string, unknown> => {
    const allowed = new Set([resource.id, ...resource.fields.filter((definition) => definition.type !== "password").map((definition) => definition.column)]);
    return normalize(Object.fromEntries(Object.entries(row).filter(([column]) => allowed.has(column)))) as Record<string, unknown>;
};
const identifier = (name: string): string => `"${name}"`;
type SqlExecutor = Pick<ReturnType<typeof getSqlClient>, "unsafe">;

export const listAdminRecords = async (resource: AdminResource, page = 1, query = "") => {
    const sql = getSqlClient();
    const perPage = 30;
    const where = `${resource.softDelete === true ? "deleted_at is null and " : ""}($1 = '' or ${identifier(resource.title)}::text ilike '%' || $1 || '%')`;
    const [rows, countRows] = await Promise.all([
        sql.unsafe(`select * from ${identifier(resource.table)} where ${where} order by ${identifier(resource.id)} desc limit $2 offset $3`, [query, perPage, (Math.max(1, page) - 1) * perPage]),
        sql.unsafe(`select count(*)::int as count from ${identifier(resource.table)} where ${where}`, [query]),
    ]);
    return { records: rows.map((row) => serializeAdminRecord(resource, row)), total: Number(countRows[0]?.count ?? 0), page: Math.max(1, page), perPage };
};

const findAdminRecordWith = async (sql: SqlExecutor, resource: AdminResource, id: string) => {
    const query = resource.slug === "blog-posts"
        ? `select p.*, s.title as seo_title, s.description as seo_description,
            s.image as seo_image, s.canonical_url, s.robots,
            (select string_agg(pt.tag_id::text, ',' order by pt.tag_id)
                from blog_post_tag pt where pt.post_id = p.id) as tag_ids
            from blog_posts p left join seo s on s.model_id = p.id
                and s.model_type = 'App\\Models\\BlogPost'
            where p.id = $1 and p.deleted_at is null limit 1`
        : `select * from ${identifier(resource.table)} where ${identifier(resource.id)} = $1${resource.softDelete === true ? " and deleted_at is null" : ""} limit 1`;
    const rows = await sql.unsafe(query, [id]);
    return rows[0] === undefined ? undefined : serializeAdminRecord(resource, rows[0]);
};
export const findAdminRecord = async (resource: AdminResource, id: string) => findAdminRecordWith(getSqlClient(), resource, id);

const inputValues = async (resource: AdminResource, input: Record<string, unknown>, creating: boolean): Promise<Record<string, unknown>> => {
    const output: Record<string, unknown> = {};
    for (const definition of resource.fields) {
        if (definition.virtual === true) continue;
        let value = input[definition.column];
        if (creating && value === undefined && definition.defaultValue !== undefined) {
            value = definition.defaultValue;
        }
        if (value === undefined) continue;
        if (value === "" && definition.type !== "text" && definition.type !== "textarea") value = null;
        if (definition.type === "number" && value !== null) value = Number(value);
        if (definition.type === "boolean") value = value === true || value === "true" || value === "1";
        if (definition.type === "datetime" && typeof value === "string" && value !== "") value = new Date(value);
        if (definition.type === "json" && typeof value === "string") value = value === "" ? {} : JSON.parse(value);
        if (definition.type === "email" && typeof value === "string") value = value.trim().toLocaleLowerCase();
        if (definition.type === "password") {
            if (value === null || value === "") continue;
            if (typeof value !== "string" || value.length < 12) throw new Error("Passwords must contain at least 12 characters.");
            value = await hash(value, 12);
        }
        output[definition.column] = value;
    }
    if (resource.slug === "system-administrators" && output.role !== undefined && !["owner", "admin", "viewer"].includes(String(output.role))) throw new Error("Role must be owner, admin, or viewer.");
    if (creating) {
        for (const definition of resource.fields) if (definition.required === true && (output[definition.column] === undefined || output[definition.column] === null || output[definition.column] === "")) throw new Error(`${definition.label} is required.`);
    }
    return output;
};

const saveBlogMetadata = async (
    sql: SqlExecutor,
    postId: string,
    input: Record<string, unknown>,
): Promise<void> => {
    if (Object.hasOwn(input, "tag_ids")) {
        const submitted = String(input.tag_ids ?? "").trim();
        const tagIds = submitted === "" ? [] : submitted.split(/[\s,]+/u);
        if (tagIds.some((id) => !/^\d+$/u.test(id))) {
            throw new Error("Tag IDs must be comma-separated numbers.");
        }
        await sql.unsafe("delete from blog_post_tag where post_id = $1", [postId]);
        if (tagIds.length > 0) {
            await sql.unsafe(
                "insert into blog_post_tag (post_id, tag_id, created_at, updated_at) select $1, unnest($2::bigint[]), now(), now()",
                [postId, tagIds] as never[],
            );
        }
    }

    const seoFields = ["seo_title", "seo_description", "seo_image", "canonical_url", "robots"] as const;
    if (seoFields.some((column) => Object.hasOwn(input, column))) {
        const seoValues = seoFields.map((column) => {
            const value = input[column];
            return value === "" || value === undefined ? null : value;
        });
        await sql.unsafe(
            `insert into seo (model_type, model_id, title, description, image, canonical_url, robots, created_at, updated_at)
             values ('App\\Models\\BlogPost', $1, $2, $3, $4, $5, $6, now(), now())
             on conflict (model_type, model_id) do update set title = excluded.title,
                description = excluded.description, image = excluded.image,
                canonical_url = excluded.canonical_url, robots = excluded.robots,
                updated_at = now()`,
            [postId, ...seoValues] as never[],
        );
    }
};

export const createAdminRecord = async (resource: AdminResource, input: Record<string, unknown>) => {
    const sql = getSqlClient();
    const data = await inputValues(resource, input, true);
    if (resource.idKind !== "serial") data[resource.id] = resource.idKind === "uuid" ? randomUUID() : ulid();
    if (resource.table === "agent_conversation_messages") {
        for (const column of ["attachments", "tool_calls", "tool_results", "usage", "meta"]) data[column] ??= {};
    }
    if (resource.table === "ai_credit_transactions") data.created_at = new Date();
    else { data.created_at = new Date(); data.updated_at = new Date(); }
    const columns = Object.keys(data);
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
    const insert = async (executor: SqlExecutor) => {
        const rows = await executor.unsafe(`insert into ${identifier(resource.table)} (${columns.map(identifier).join(", ")}) values (${placeholders}) returning *`, columns.map((column) => data[column]) as never[]);
        if (resource.slug === "blog-posts" && rows[0] !== undefined) await saveBlogMetadata(executor, String(rows[0][resource.id]), input);
        return serializeAdminRecord(resource, rows[0] ?? {});
    };
    return resource.slug === "blog-posts" ? sql.begin((transaction) => insert(transaction)) : insert(sql);
};

export const updateAdminRecord = async (resource: AdminResource, id: string, input: Record<string, unknown>) => {
    const sql = getSqlClient();
    const data = await inputValues(resource, input, false);
    if (resource.table !== "ai_credit_transactions") data.updated_at = new Date();
    const columns = Object.keys(data);
    if (columns.length === 0 && resource.slug !== "blog-posts") return findAdminRecord(resource, id);
    const set = columns.map((column, index) => `${identifier(column)} = $${index + 1}`).join(", ");
    const update = async (executor: SqlExecutor) => {
        const rows = columns.length === 0
            ? await executor.unsafe(`select ${identifier(resource.id)} from ${identifier(resource.table)} where ${identifier(resource.id)} = $1 limit 1`, [id])
            : await executor.unsafe(`update ${identifier(resource.table)} set ${set} where ${identifier(resource.id)} = $${columns.length + 1} returning *`, [...columns.map((column) => data[column]), id] as never[]);
        if (resource.slug === "blog-posts" && rows[0] !== undefined) {
            await saveBlogMetadata(executor, id, input);
            return findAdminRecordWith(executor, resource, id);
        }
        return rows[0] === undefined ? undefined : serializeAdminRecord(resource, rows[0]);
    };
    return resource.slug === "blog-posts" ? sql.begin((transaction) => update(transaction)) : update(sql);
};

export const deleteAdminRecord = async (resource: AdminResource, id: string): Promise<boolean> => {
    const sql = getSqlClient();
    const rows = resource.softDelete === true
        ? await sql.unsafe(`update ${identifier(resource.table)} set deleted_at = now(), updated_at = now() where ${identifier(resource.id)} = $1 and deleted_at is null returning ${identifier(resource.id)}`, [id])
        : await sql.unsafe(`delete from ${identifier(resource.table)} where ${identifier(resource.id)} = $1 returning ${identifier(resource.id)}`, [id]);
    return rows.length > 0;
};

export const dashboardMetrics = async (): Promise<readonly { label: string; value: number; href: string }[]> => {
    const selected = resources.filter((resource) => ["users", "teams", "companies", "people", "opportunities", "subscriptions", "blog-posts", "ai-conversations"].includes(resource.slug));
    const sql = getSqlClient();
    return Promise.all(selected.map(async (resource) => {
        const rows = await sql.unsafe(`select count(*)::int as count from ${identifier(resource.table)}${resource.softDelete === true ? " where deleted_at is null" : ""}`);
        return { label: resource.label, value: Number(rows[0]?.count ?? 0), href: `/sysadmin/${resource.slug}` };
    }));
};
