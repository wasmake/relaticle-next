import { and, asc, count, eq, ilike, inArray, type SQL } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { customFieldOptions, customFields } from "@/server/db/schema";
import { ulidSchema, type Ulid } from "@/server/ids";

import type { CustomFieldMetadataRepository } from "./repository";
import type { CustomFieldMetadataPage, CustomFieldMetadataQuery } from "./types";

type Database = ReturnType<typeof getDatabase>;

export class DrizzleCustomFieldMetadataRepository implements CustomFieldMetadataRepository {
    public constructor(private readonly database: Database = getDatabase()) {}

    public async list(
        teamId: Ulid,
        query: CustomFieldMetadataQuery,
    ): Promise<CustomFieldMetadataPage> {
        const conditions: SQL[] = [
            eq(customFields.tenantId, teamId),
            eq(customFields.active, query.filters.active),
        ];

        if (query.filters.entityType !== undefined) {
            conditions.push(eq(customFields.entityType, query.filters.entityType));
        }
        if (query.filters.type !== undefined) {
            conditions.push(eq(customFields.type, query.filters.type));
        }
        if (query.filters.code !== undefined) {
            conditions.push(ilike(customFields.code, `%${query.filters.code}%`));
        }

        const where = and(...conditions);
        const [rows, totals] = await Promise.all([
            this.database
                .select()
                .from(customFields)
                .where(where)
                .orderBy(asc(customFields.sortOrder), asc(customFields.code), asc(customFields.id))
                .limit(query.perPage)
                .offset((query.page - 1) * query.perPage),
            this.database.select({ value: count() }).from(customFields).where(where),
        ]);
        const ids = rows.map((row) => row.id);
        const optionRows = ids.length === 0
            ? []
            : await this.database
                  .select()
                  .from(customFieldOptions)
                  .where(
                      and(
                          eq(customFieldOptions.tenantId, teamId),
                          inArray(customFieldOptions.customFieldId, ids),
                      ),
                  )
                  .orderBy(asc(customFieldOptions.sortOrder), asc(customFieldOptions.name));

        return {
            records: rows.map((row) => ({
                id: ulidSchema.parse(row.id),
                sectionId:
                    row.customFieldSectionId === null
                        ? null
                        : ulidSchema.parse(row.customFieldSectionId),
                code: row.code,
                name: row.name,
                type: row.type,
                lookupType: row.lookupType,
                entityType: row.entityType,
                sortOrder: row.sortOrder,
                validationRules: row.validationRules,
                active: row.active,
                systemDefined: row.systemDefined,
                settings: row.settings,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                options: optionRows
                    .filter((option) => option.customFieldId === row.id)
                    .map((option) => ({
                        id: ulidSchema.parse(option.id),
                        name: option.name,
                        sortOrder: option.sortOrder,
                        settings: option.settings,
                    })),
            })),
            page: query.page,
            perPage: query.perPage,
            total: totals[0]?.value ?? 0,
        };
    }
}
