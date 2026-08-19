import { and, eq, or } from "drizzle-orm";

import type { CustomFieldEntityType } from "@/server/custom-fields/types";
import { getDatabase } from "@/server/db/client";
import { media } from "@/server/db/schema";

export class DrizzleMediaCustomFieldReferences {
    public constructor(private readonly database = getDatabase()) {}

    public async owns(teamId: string, entityType: CustomFieldEntityType, entityId: string, uuid: string): Promise<boolean> {
        const [record] = await this.database.select({ id: media.id }).from(media).where(and(
            eq(media.uuid, uuid),
            or(
                and(eq(media.modelType, entityType), eq(media.modelId, entityId)),
                and(eq(media.modelType, "team"), eq(media.modelId, teamId)),
            ),
        )).limit(1);
        return record !== undefined;
    }
}
