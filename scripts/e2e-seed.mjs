import { hash } from "bcryptjs";
import postgres from "postgres";

const databaseUrl =
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:5432/relaticle_e2e";
const client = postgres(databaseUrl, { max: 1, prepare: false });
const userId = "01K2Y000000000000000000001";
const teamId = "01K2Y000000000000000000002";
const password = await hash("correct-horse-battery-staple", 12);

try {
    await client.begin(async (transaction) => {
        await transaction`
            insert into users (id, name, email, email_verified_at, password, created_at, updated_at)
            values (${userId}, 'Ada Lovelace', 'ada@example.test', now(), ${password}, now(), now())
            on conflict (email) do update set password = excluded.password, email_verified_at = excluded.email_verified_at
        `;
        await transaction`
            insert into teams (id, user_id, name, slug, personal_team, created_at, updated_at)
            values (${teamId}, ${userId}, 'Analytical Engines', 'analytical-engines', false, now(), now())
            on conflict (slug) do nothing
        `;
        await transaction`
            update users set current_team_id = ${teamId}, updated_at = now()
            where email = 'ada@example.test'
        `;
    });
} finally {
    await client.end();
}
