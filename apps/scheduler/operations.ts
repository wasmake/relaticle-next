import { mkdir, rename, statfs, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { JSONValue } from "postgres";
import { Resend } from "resend";
import { ulid } from "ulidx";

import type { SchedulerSqlClient } from "./database.js";
import type { SchedulerEnvironment } from "./environment.js";

export interface ScheduleOperations {
    resetCredits(now: Date): Promise<void>;
    processTrials(now: Date, signal: AbortSignal): Promise<void>;
    updateDisposableDomains(signal: AbortSignal): Promise<void>;
    syncSubscriberRecency(now: Date, signal: AbortSignal): Promise<void>;
    purgeScheduledDeletions(now: Date, signal: AbortSignal): Promise<void>;
    sendTaskDigests(now: Date, signal: AbortSignal): Promise<void>;
    runHealthChecks(now: Date): Promise<void>;
    queueHeartbeat(now: Date): Promise<void>;
    scheduleHeartbeat(now: Date): Promise<void>;
}

type TeamRow = Readonly<{
    id: string;
    name: string;
    plan: string;
    user_id: string;
    owner_email: string;
    owner_name: string;
    trial_ends_at: Date | null;
}>;
type BalanceRow = Readonly<{
    team_id: string;
    purchased_credits: number;
    credits_remaining: number;
    credits_used: number;
    period_ends_at: Date;
}>;
type SubscriptionRow = Readonly<{
    stripe_id: string;
    created_at: Date | null;
    ends_at: Date | null;
}>;
type SubscriberRow = Readonly<{
    id: string;
    mailcoach_subscriber_uuid: string;
    last_login_at: Date | null;
    subscriber_recency_bucket: string | null;
}>;
type DigestUserRow = Readonly<{
    id: string;
    name: string;
    email: string;
    timezone: string | null;
    notification_preferences: JSONValue | null;
}>;
type DigestTaskRow = Readonly<{
    user_id: string;
    team_id: string;
    team_name: string;
    id: string;
    title: string;
    due_at: Date;
}>;
type PurgeRow = Readonly<{
    id: string;
    kind: "team" | "user";
    stripe_ids: string[] | null;
}>;

const planCredits: Readonly<Record<string, number>> = {
    free: 300,
    pro: 2_000,
    enterprise: 10_000,
};
const disposableWhitelist = new Set([
    "relaticle.com", "aol.com", "fastmail.com", "gmail.com", "gmx.com",
    "hotmail.com", "icloud.com", "live.com", "me.com", "msn.com",
    "outlook.com", "proton.me", "protonmail.com", "yahoo.com", "yandex.com",
    "zoho.com",
]);

const escapeHtml = (value: string): string =>
    value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const addMonthsClamped = (date: Date, months: number): Date => {
    const result = new Date(date);
    const day = result.getUTCDate();
    result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
    result.setUTCDate(Math.min(day, lastDay));
    return result;
};

export const creditPeriodBounds = (
    now: Date,
    subscriptionAnchor: Date | null,
    trialEndsAt: Date | null,
): Readonly<{ start: Date; end: Date }> => {
    if (subscriptionAnchor !== null) {
        let elapsed = Math.max(
            0,
            (now.getUTCFullYear() - subscriptionAnchor.getUTCFullYear()) * 12 +
                now.getUTCMonth() - subscriptionAnchor.getUTCMonth(),
        );
        for (let attempt = 0; attempt <= 6; attempt += 1) {
            const start = addMonthsClamped(subscriptionAnchor, elapsed);
            const end = addMonthsClamped(subscriptionAnchor, elapsed + 1);
            if (start <= now && now < end) return { start, end };
            elapsed = Math.max(0, elapsed + (start > now ? -1 : 1));
        }
        throw new Error("Unable to calculate subscription credit period.");
    }
    if (trialEndsAt !== null && trialEndsAt > now) {
        return { start: new Date(trialEndsAt.getTime() - 14 * 86_400_000), end: trialEndsAt };
    }
    return {
        start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
        end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
    };
};

export const subscriberRecencyBucket = (lastLogin: Date | null, now: Date): string | null => {
    if (lastLogin === null) return null;
    const days = Math.floor(Math.abs(now.getTime() - lastLogin.getTime()) / 86_400_000);
    if (days <= 7) return "active-7d";
    if (days <= 30) return "active-30d";
    if (days > 60) return "dormant";
    return null;
};

export const sitemapLinks = (html: string, baseUrl: URL): readonly string[] => {
    const links = new Set<string>();
    const pattern = /<a\s+[^>]*href\s*=\s*["']([^"']+)["']/giu;
    for (const match of html.matchAll(pattern)) {
        const href = match[1];
        if (href === undefined) continue;
        try {
            const url = new URL(href, baseUrl);
            if (url.origin === baseUrl.origin && ["http:", "https:"].includes(url.protocol)) {
                url.hash = "";
                url.search = "";
                links.add(url.toString());
            }
        } catch {
            // Ignore malformed links from crawled markup.
        }
    }
    return [...links];
};

interface MailMessage {
    readonly to: string;
    readonly subject: string;
    readonly html: string;
}

class MailTransport {
    private readonly resend: Resend | undefined;

    public constructor(private readonly environment: SchedulerEnvironment) {
        this.resend = environment.MAIL_MAILER === "resend" && environment.RESEND_KEY
            ? new Resend(environment.RESEND_KEY)
            : undefined;
        if (environment.MAIL_MAILER === "resend" && this.resend === undefined) {
            throw new Error("RESEND_KEY is required when MAIL_MAILER=resend.");
        }
    }

    public async send(message: MailMessage): Promise<void> {
        if (this.resend === undefined) {
            console.info("Scheduler email", { to: message.to, subject: message.subject });
            return;
        }
        const response = await this.resend.emails.send({
            from: `${this.environment.MAIL_FROM_NAME} <${this.environment.MAIL_FROM_ADDRESS}>`,
            to: message.to,
            subject: message.subject,
            html: message.html,
        });
        if (response.error !== null) throw new Error(response.error.message);
    }
}

export class ProductionScheduleOperations implements ScheduleOperations {
    private readonly mail: MailTransport;

    public constructor(
        private readonly sql: SchedulerSqlClient,
        private readonly redis: Redis,
        private readonly environment: SchedulerEnvironment,
    ) {
        this.mail = new MailTransport(environment);
    }

    public async resetCredits(now: Date): Promise<void> {
        const balances = await this.sql<readonly BalanceRow[]>`
            select team_id, purchased_credits, credits_remaining, credits_used, period_ends_at
            from ai_credit_balances where period_ends_at < ${now}
        `;
        for (const balance of balances) {
            const [team] = await this.sql<readonly TeamRow[]>`
                select t.*, u.email as owner_email, u.name as owner_name
                from teams t join users u on u.id = t.user_id where t.id = ${balance.team_id}
            `;
            if (team === undefined) continue;
            const [subscription] = await this.sql<readonly SubscriptionRow[]>`
                select stripe_id, created_at, ends_at from subscriptions
                where team_id = ${team.id} and (ends_at is null or ends_at > ${now})
                order by created_at limit 1
            `;
            const bounds = creditPeriodBounds(now, subscription?.created_at ?? null, team.trial_ends_at);
            await this.resetTeamBalance(team, balance, bounds, now);
        }
    }

    public async processTrials(now: Date, signal: AbortSignal): Promise<void> {
        const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 3));
        const end = new Date(start.getTime() + 86_400_000);
        const reminders = await this.sql<readonly TeamRow[]>`
            select t.*, u.email as owner_email, u.name as owner_name
            from teams t join users u on u.id = t.user_id
            where t.trial_ends_at >= ${start} and t.trial_ends_at < ${end}
              and not exists (select 1 from subscriptions s where s.team_id = t.id and (s.ends_at is null or s.ends_at > ${now}))
        `;
        for (const team of reminders) {
            if (signal.aborted) break;
            await this.sendOnce(`trial-reminder:${team.id}:${start.toISOString().slice(0, 10)}`, 7 * 86_400, {
                to: team.owner_email,
                subject: `Your ${team.name} Pro trial ends in 3 days`,
                html: `<p>Hello ${escapeHtml(team.owner_name)},</p><p>Your ${escapeHtml(team.name)} Pro trial ends in 3 days.</p><p><a href="${this.environment.APP_URL}/${this.environment.APP_PANEL_PATH}/${team.id}/billing">Review billing</a></p>`,
            });
        }
        const expired = await this.sql<readonly TeamRow[]>`
            select t.*, u.email as owner_email, u.name as owner_name
            from teams t join users u on u.id = t.user_id
            where t.trial_ends_at is not null and t.trial_ends_at < ${now}
        `;
        for (const team of expired) {
            const [live] = await this.sql<readonly { exists: boolean }[]>`
                select exists(select 1 from subscriptions where team_id = ${team.id} and (ends_at is null or ends_at > ${now})) as exists
            `;
            await this.sql.begin(async (transaction) => {
                await transaction`update teams set plan = case when ${live?.exists ?? false} or plan <> 'pro' then plan else 'free' end, trial_ends_at = null, updated_at = ${now} where id = ${team.id} and trial_ends_at < ${now}`;
                if (!(live?.exists ?? false) && team.plan === "pro") {
                    const [balance] = await transaction<readonly BalanceRow[]>`select * from ai_credit_balances where team_id = ${team.id} for update`;
                    if (balance !== undefined) {
                        const bounds = creditPeriodBounds(now, null, null);
                        const resetKey = `trial-expired:${team.trial_ends_at?.toISOString() ?? team.id}`;
                        const inserted = await transaction<readonly { id: string }[]>`
                            insert into ai_credit_transactions (id, team_id, user_id, conversation_id, idempotency_key, type, model, input_tokens, output_tokens, credits_charged, metadata, created_at)
                            values (${ulid()}, ${team.id}, null, null, ${resetKey}, 'adjustment', 'system', 0, 0, 0, ${transaction.json({ action: "reset_period", plan: "free", allowance_granted: 300 } as JSONValue)}, ${now})
                            on conflict (team_id, idempotency_key) do nothing returning id
                        `;
                        if (inserted.length > 0) {
                            await transaction`update ai_credit_balances set credits_remaining = 300 + purchased_credits, credits_used = 0, period_starts_at = ${bounds.start}, period_ends_at = ${bounds.end}, updated_at = ${now} where team_id = ${team.id}`;
                        }
                    }
                }
            });
        }
    }

    public async updateDisposableDomains(signal: AbortSignal): Promise<void> {
        const response = await fetch(this.environment.DISPOSABLE_DOMAINS_URL, { signal });
        if (!response.ok) throw new Error(`Disposable domain source returned HTTP ${response.status}.`);
        const payload: unknown = await response.json();
        if (!Array.isArray(payload)) throw new Error("Disposable domain source is not an array.");
        const domains = [...new Set(payload.filter((value): value is string => typeof value === "string").map((value) => value.trim().toLowerCase()).filter((value) => /^[a-z0-9.-]+\.[a-z]{2,}$/u.test(value) && !disposableWhitelist.has(value)))].sort();
        if (domains.length < 5_000) throw new Error(`Disposable domain source contained only ${domains.length} valid domains.`);
        await this.atomicWrite(this.environment.DISPOSABLE_DOMAINS_PATH, `${JSON.stringify(domains)}\n`);
        await this.redis.del(`${this.environment.REDIS_PREFIX}disposable_email:domains`);
    }

    public async syncSubscriberRecency(now: Date, signal: AbortSignal): Promise<void> {
        if (!this.environment.MAILCOACH_ENABLED_SUBSCRIBERS_SYNC) return;
        const endpoint = this.environment.MAILCOACH_API_ENDPOINT;
        const token = this.environment.MAILCOACH_API_TOKEN;
        if (endpoint === undefined || token === undefined) throw new Error("Mailcoach endpoint and token are required when subscriber sync is enabled.");
        const users = await this.sql<readonly SubscriberRow[]>`select id, mailcoach_subscriber_uuid, last_login_at, subscriber_recency_bucket from users where mailcoach_subscriber_uuid is not null`;
        for (const user of users) {
            if (signal.aborted) break;
            const next = subscriberRecencyBucket(user.last_login_at, now);
            if (next === user.subscriber_recency_bucket) continue;
            const url = `${endpoint.replace(/\/$/u, "")}/subscribers/${encodeURIComponent(user.mailcoach_subscriber_uuid)}/tags`;
            if (user.subscriber_recency_bucket !== null) await this.mailcoach(url, "DELETE", token, user.subscriber_recency_bucket, signal);
            if (next !== null) await this.mailcoach(url, "POST", token, next, signal);
            await this.sql`update users set subscriber_recency_bucket = ${next}, updated_at = ${now} where id = ${user.id} and subscriber_recency_bucket is not distinct from ${user.subscriber_recency_bucket}`;
        }
    }

    public async purgeScheduledDeletions(now: Date, signal: AbortSignal): Promise<void> {
        const rows = await this.sql<readonly PurgeRow[]>`
            select t.id, 'team'::text as kind, array_remove(array_agg(s.stripe_id), null) as stripe_ids
            from teams t left join subscriptions s on s.team_id = t.id and (s.ends_at is null or s.ends_at > ${now})
            where t.scheduled_deletion_at < ${now} group by t.id
            union all
            select u.id, 'user'::text as kind, array_remove(array_agg(s.stripe_id), null) as stripe_ids
            from users u left join teams t on t.user_id = u.id left join subscriptions s on s.team_id = t.id and (s.ends_at is null or s.ends_at > ${now})
            where u.scheduled_deletion_at < ${now} group by u.id
        `;
        const cancelledSubscriptions = new Set<string>();
        const orderedRows = [...rows].sort((left, right) =>
            left.kind === right.kind ? 0 : left.kind === "user" ? -1 : 1,
        );
        for (const row of orderedRows) {
            if (signal.aborted) break;
            for (const subscription of row.stripe_ids ?? []) {
                if (cancelledSubscriptions.has(subscription)) continue;
                await this.cancelStripeSubscription(subscription, signal);
                cancelledSubscriptions.add(subscription);
            }
            if (row.kind === "team") await this.sql`delete from teams where id = ${row.id} and scheduled_deletion_at < ${now}`;
            else await this.sql`delete from users where id = ${row.id} and scheduled_deletion_at < ${now}`;
        }
        await this.sendDeletionReminders(now, signal);
    }

    public async sendTaskDigests(now: Date, signal: AbortSignal): Promise<void> {
        const zones = Intl.supportedValuesOf("timeZone").filter((zone) => Number(new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", hourCycle: "h23" }).format(now)) === 8);
        const appAtEight = Number(new Intl.DateTimeFormat("en-US", { timeZone: this.environment.APP_TIMEZONE, hour: "numeric", hourCycle: "h23" }).format(now)) === 8;
        const users = await this.sql<readonly DigestUserRow[]>`
            select id, name, email, timezone, notification_preferences from users
            where timezone = any(${this.sql.array(zones)}) or (${appAtEight} and timezone is null)
        `;
        for (const user of users) {
            if (signal.aborted || !this.wantsDigest(user.notification_preferences)) continue;
            const zone = user.timezone ?? this.environment.APP_TIMEZONE;
            const localParts = new Map(
                new Intl.DateTimeFormat("en-US", {
                    timeZone: zone,
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                }).formatToParts(now).map(({ type, value }) => [type, value]),
            );
            const local = `${localParts.get("year")}-${localParts.get("month")}-${localParts.get("day")}`;
            const localStart = this.zonedMidnight(local, zone);
            const tasks = await this.digestTasks(user.id, new Date(localStart.getTime() + 86_400_000));
            if (tasks.length === 0) continue;
            const items = tasks.map((task) => `<li><a href="${this.environment.APP_URL}/${this.environment.APP_PANEL_PATH}/${task.team_id}/tasks?tableAction=edit&amp;tableActionRecord=${task.id}">${escapeHtml(task.title)}</a> - due ${task.due_at.toISOString().slice(0, 10)}</li>`).join("");
            await this.sendOnce(`task-digest:${user.id}:${local}`, 3 * 86_400, {
                to: user.email,
                subject: "Your tasks for today",
                html: `<p>${escapeHtml(user.name.split(" ")[0] ?? user.name)}, here's your task digest.</p><ul>${items}</ul>`,
            });
        }
    }

    public async runHealthChecks(now: Date): Promise<void> {
        const results: Record<string, { ok: boolean; detail?: string }> = {};
        try { await this.sql`select 1`; results.database = { ok: true }; } catch (error) { results.database = { ok: false, detail: String(error) }; }
        try { results.redis = { ok: (await this.redis.ping()) === "PONG" }; } catch (error) { results.redis = { ok: false, detail: String(error) }; }
        const heartbeat = await this.redis.get(`${this.environment.REDIS_PREFIX}scheduler:heartbeat`);
        results.scheduler = { ok: heartbeat !== null && now.getTime() / 1_000 - Number(heartbeat) <= 120 };
        try {
            const disk = await statfs(process.cwd());
            const used = 1 - Number(disk.bavail) / Number(disk.blocks);
            results.disk = { ok: used < 0.9, detail: `${Math.round(used * 100)}% used` };
        } catch (error) { results.disk = { ok: false, detail: String(error) }; }
        await this.redis.set(`${this.environment.REDIS_PREFIX}health:results`, JSON.stringify({ checkedAt: now.toISOString(), results }));
        if (Object.values(results).some(({ ok }) => !ok)) throw new Error("One or more health checks failed.");
    }

    public async queueHeartbeat(now: Date): Promise<void> {
        const statuses: Record<string, number> = {};
        for (const name of ["default", "imports", "chat"] as const) {
            const queue = new Queue(name, { connection: this.redis, prefix: this.environment.BULLMQ_PREFIX });
            try { statuses[name] = (await queue.getWorkers()).length; } finally { await queue.close(); }
        }
        await this.redis.set(`${this.environment.REDIS_PREFIX}health:queue-heartbeat`, JSON.stringify({ at: now.toISOString(), workers: statuses }));
        if (statuses.default === 0 || statuses.imports === 0 || statuses.chat === 0) throw new Error("A monitored queue has no active workers.");
    }

    public async scheduleHeartbeat(now: Date): Promise<void> {
        await this.redis.set(`${this.environment.REDIS_PREFIX}scheduler:heartbeat`, Math.floor(now.getTime() / 1_000).toString());
    }

    private async resetTeamBalance(team: TeamRow, balance: BalanceRow, bounds: Readonly<{ start: Date; end: Date }>, now: Date): Promise<void> {
        const allowance = planCredits[team.plan] ?? planCredits.free ?? 300;
        const key = `scheduler-reset:${bounds.start.toISOString()}`;
        await this.sql.begin(async (transaction) => {
            const [locked] = await transaction<readonly BalanceRow[]>`select * from ai_credit_balances where team_id = ${team.id} and period_ends_at < ${now} for update`;
            if (locked === undefined) return;
            const inserted = await transaction<readonly { id: string }[]>`
                insert into ai_credit_transactions (id, team_id, user_id, conversation_id, idempotency_key, type, model, input_tokens, output_tokens, credits_charged, metadata, created_at)
                values (${ulid()}, ${team.id}, null, null, ${key}, 'adjustment', 'system', 0, 0, 0, ${transaction.json({ action: "reset_period", plan: team.plan, allowance_granted: allowance } as JSONValue)}, ${now})
                on conflict (team_id, idempotency_key) do nothing returning id
            `;
            if (inserted.length === 0) return;
            await transaction`update ai_credit_balances set credits_remaining = ${allowance} + purchased_credits, credits_used = 0, period_starts_at = ${bounds.start}, period_ends_at = ${bounds.end}, updated_at = ${now} where team_id = ${team.id}`;
        });
    }

    private async digestTasks(userId: string, windowEnd: Date): Promise<readonly DigestTaskRow[]> {
        return this.sql<readonly DigestTaskRow[]>`
            select distinct ${userId} as user_id, t.team_id, teams.name as team_name, t.id, t.title, due.datetime_value as due_at
            from tasks t join teams on teams.id = t.team_id join task_user tu on tu.task_id = t.id and tu.user_id = ${userId}
            join custom_fields due_field on due_field.tenant_id = t.team_id and due_field.entity_type = 'task' and due_field.code = 'due_date'
            join custom_field_values due on due.entity_id = t.id and due.entity_type = 'task' and due.custom_field_id = due_field.id
            left join custom_fields status_field on status_field.tenant_id = t.team_id and status_field.entity_type = 'task' and status_field.code = 'status'
            left join custom_field_options done on done.custom_field_id = status_field.id and done.name = 'Done'
            where t.deleted_at is null and due.datetime_value is not null and due.datetime_value < ${windowEnd}
              and not exists (select 1 from custom_field_values status where status.entity_id = t.id and status.entity_type = 'task' and status.custom_field_id = status_field.id and status.string_value = done.id)
            order by due.datetime_value
        `;
    }

    private wantsDigest(value: JSONValue | null): boolean {
        if (
            value === null ||
            value instanceof Date ||
            Array.isArray(value) ||
            typeof value !== "object"
        ) return true;
        const taskDigest = (value as Readonly<Record<string, unknown>>).task_digest;
        return !(
            taskDigest !== null &&
            !(taskDigest instanceof Date) &&
            !Array.isArray(taskDigest) &&
            typeof taskDigest === "object" &&
            (taskDigest as Readonly<Record<string, unknown>>).email === false
        );
    }

    private zonedMidnight(date: string, zone: string): Date {
        const [year, month, day] = date.split("-").map(Number);
        if (year === undefined || month === undefined || day === undefined) {
            throw new Error(`Invalid local date: ${date}.`);
        }
        const desired = Date.UTC(year, month - 1, day);
        let candidate = desired;
        const formatter = new Intl.DateTimeFormat("en-US", {
            timeZone: zone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
        });
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const values = new Map(
                formatter.formatToParts(new Date(candidate)).map(({ type, value }) => [type, value]),
            );
            const rendered = Date.UTC(
                Number(values.get("year")),
                Number(values.get("month")) - 1,
                Number(values.get("day")),
                Number(values.get("hour")),
                Number(values.get("minute")),
            );
            candidate += desired - rendered;
        }
        return new Date(candidate);
    }

    private async sendDeletionReminders(now: Date, signal: AbortSignal): Promise<void> {
        const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 5));
        const end = new Date(target.getTime() + 86_400_000);
        const recipients = await this.sql<readonly { id: string; email: string; name: string; subject: string; deletion_at: Date }[]>`
            select u.id, u.email, u.name, 'Your account will be deleted in 5 days' as subject, u.scheduled_deletion_at as deletion_at from users u where u.scheduled_deletion_at >= ${target} and u.scheduled_deletion_at < ${end}
            union all
            select t.id, u.email, u.name, t.name || ' will be deleted in 5 days', t.scheduled_deletion_at from teams t join users u on u.id = t.user_id where t.scheduled_deletion_at >= ${target} and t.scheduled_deletion_at < ${end}
        `;
        for (const recipient of recipients) {
            if (signal.aborted) break;
            await this.sendOnce(`deletion-reminder:${recipient.id}:${target.toISOString().slice(0, 10)}`, 7 * 86_400, { to: recipient.email, subject: recipient.subject, html: `<p>Hello ${escapeHtml(recipient.name)},</p><p>Permanent deletion is scheduled for ${recipient.deletion_at.toISOString().slice(0, 10)}.</p>` });
        }
    }

    private async sendOnce(key: string, seconds: number, message: MailMessage): Promise<void> {
        const redisKey = `${this.environment.REDIS_PREFIX}scheduler:sent:${key}`;
        if ((await this.redis.set(redisKey, "pending", "EX", seconds, "NX")) !== "OK") return;
        try { await this.mail.send(message); await this.redis.set(redisKey, "sent", "EX", seconds); }
        catch (error) { await this.redis.del(redisKey); throw error; }
    }

    private async mailcoach(url: string, method: "DELETE" | "POST", token: string, tag: string, signal: AbortSignal): Promise<void> {
        const response = await fetch(url, { method, signal, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ tags: [tag] }) });
        if (!response.ok) throw new Error(`Mailcoach returned HTTP ${response.status}.`);
    }

    private async cancelStripeSubscription(id: string, signal: AbortSignal): Promise<void> {
        if (this.environment.STRIPE_SECRET === undefined) throw new Error(`Refusing to purge a team with live Stripe subscription ${id} without STRIPE_SECRET.`);
        const response = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE", signal, headers: { authorization: `Bearer ${this.environment.STRIPE_SECRET}` } });
        if (!response.ok && response.status !== 404) throw new Error(`Stripe cancellation for ${id} returned HTTP ${response.status}.`);
    }

    private async atomicWrite(path: string, content: string): Promise<void> {
        const destination = resolve(path);
        await mkdir(dirname(destination), { recursive: true });
        const temporary = `${destination}.${process.pid}.tmp`;
        await writeFile(temporary, content, { encoding: "utf8", mode: 0o644 });
        await rename(temporary, destination);
    }
}
