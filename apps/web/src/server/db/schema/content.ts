import {
    bigint,
    bigserial,
    foreignKey,
    index,
    pgTable,
    primaryKey,
    text,
    timestamp,
    unique,
    varchar,
} from "drizzle-orm/pg-core";

import { users } from "./core";
import { laravelTimestamps } from "./shared";

export const blogCategories = pgTable(
    "blog_categories",
    {
        id: bigserial("id", { mode: "bigint" }).primaryKey(),
        name: varchar("name", { length: 255 }).notNull(),
        slug: varchar("slug", { length: 255 }).notNull(),
        ...laravelTimestamps(),
        deletedAt: timestamp("deleted_at", { mode: "date" }),
    },
    (table) => [unique("blog_categories_slug_unique").on(table.slug)],
);

export const blogPosts = pgTable(
    "blog_posts",
    {
        id: bigserial("id", { mode: "bigint" }).primaryKey(),
        title: varchar("title", { length: 255 }).notNull(),
        slug: varchar("slug", { length: 255 }).notNull(),
        content: text("content").notNull(),
        excerpt: text("excerpt"),
        featuredImage: varchar("featured_image", { length: 255 }),
        categoryId: bigint("category_id", { mode: "bigint" }),
        authorId: varchar("author_id", { length: 26 }),
        status: varchar("status", { length: 255 })
            .default("draft")
            .notNull(),
        publishedAt: timestamp("published_at", { mode: "date" }),
        ...laravelTimestamps(),
        deletedAt: timestamp("deleted_at", { mode: "date" }),
    },
    (table) => [
        foreignKey({
            name: "blog_posts_category_id_foreign",
            columns: [table.categoryId],
            foreignColumns: [blogCategories.id],
        }).onDelete("set null"),
        foreignKey({
            name: "blog_posts_author_id_foreign",
            columns: [table.authorId],
            foreignColumns: [users.id],
        }).onDelete("set null"),
        unique("blog_posts_slug_unique").on(table.slug),
        index("blog_posts_status_published_at_index").on(
            table.status,
            table.publishedAt,
        ),
    ],
);

export const blogTags = pgTable(
    "blog_tags",
    {
        id: bigserial("id", { mode: "bigint" }).primaryKey(),
        name: varchar("name", { length: 255 }).notNull(),
        slug: varchar("slug", { length: 255 }).notNull(),
        deletedAt: timestamp("deleted_at", { mode: "date" }),
        ...laravelTimestamps(),
    },
    (table) => [unique("blog_tags_slug_unique").on(table.slug)],
);

export const blogPostTag = pgTable(
    "blog_post_tag",
    {
        postId: bigint("post_id", { mode: "bigint" }).notNull(),
        tagId: bigint("tag_id", { mode: "bigint" }).notNull(),
        ...laravelTimestamps(),
    },
    (table) => [
        foreignKey({
            name: "blog_post_tag_post_id_foreign",
            columns: [table.postId],
            foreignColumns: [blogPosts.id],
        }).onDelete("cascade"),
        foreignKey({
            name: "blog_post_tag_tag_id_foreign",
            columns: [table.tagId],
            foreignColumns: [blogTags.id],
        }).onDelete("cascade"),
        primaryKey({
            name: "blog_post_tag_pkey",
            columns: [table.postId, table.tagId],
        }),
        index("blog_post_tag_tag_id_index").on(table.tagId),
    ],
);
