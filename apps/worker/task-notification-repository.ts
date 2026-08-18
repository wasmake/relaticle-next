import type { JSONValue } from "postgres";

import type {
    DatabaseNotificationRow,
    TaskNotificationRecipient,
    TaskNotificationRepository,
} from "./jobs/task-assignees-added.js";
import type { WorkerSqlClient } from "./database.js";

type RecipientRow = Readonly<{
    id: string;
    name: string;
    email: string;
    notification_preferences: JSONValue | null;
}>;

export class PostgresTaskNotificationRepository implements TaskNotificationRepository {
    public constructor(private readonly sql: WorkerSqlClient) {}

    public async findTeamSlug(teamId: string): Promise<string | undefined> {
        const [team] = await this.sql<readonly { slug: string }[]>`
            select slug
            from teams
            where id = ${teamId}
            limit 1
        `;

        return team?.slug;
    }

    public async findRecipients(
        teamId: string,
        recipientIds: readonly string[],
    ): Promise<readonly TaskNotificationRecipient[]> {
        if (recipientIds.length === 0) {
            return [];
        }

        const rows = await this.sql<readonly RecipientRow[]>`
            select
                users.id,
                users.name,
                users.email,
                users.notification_preferences
            from users
            where users.id = any(${this.sql.array([...recipientIds])})
              and (
                  exists (
                      select 1
                      from teams
                      where teams.id = ${teamId}
                        and teams.user_id = users.id
                  )
                  or exists (
                      select 1
                      from team_user
                      where team_user.team_id = ${teamId}
                        and team_user.user_id = users.id
                  )
              )
        `;

        return rows.map((row) => ({
            id: row.id,
            name: row.name,
            email: row.email,
            notificationPreferences: row.notification_preferences,
        }));
    }

    public async insertDatabaseNotifications(
        rows: readonly DatabaseNotificationRow[],
    ): Promise<void> {
        await this.sql.begin(async (transaction) => {
            for (const row of rows) {
                await transaction`
                    insert into notifications (
                        id,
                        type,
                        notifiable_type,
                        notifiable_id,
                        data,
                        read_at,
                        created_at,
                        updated_at
                    ) values (
                        ${row.id},
                        ${row.type},
                        ${row.notifiableType},
                        ${row.notifiableId},
                        ${transaction.json(row.data as JSONValue)},
                        ${row.readAt},
                        ${row.createdAt},
                        ${row.updatedAt}
                    )
                    on conflict (id) do nothing
                `;
            }
        });
    }
}
