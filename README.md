# Relaticle Next

Relaticle Next is a standalone Node.js migration of the Relaticle CRM backend. It uses Next.js App Router route handlers for the HTTP API, PostgreSQL through Drizzle ORM, Redis for rate limiting and queues, and BullMQ workers for asynchronous notifications.

This repository contains no PHP runtime or Composer dependencies.

## Current Status

The implemented surface is an API backend, not a complete CRM product replacement.

- Available: health checks, authentication compatibility, workspace isolation, hosted-access enforcement, CRM CRUD APIs, custom-field persistence, activity logging, API throttling, and task-assignment notifications.
- Not available: browser CRM pages, login or registration pages, chat, imports, MCP, OAuth flows, billing UI, documentation, blog, system administration, and a scheduler runtime.
- Database requirement: the application currently targets an existing Relaticle PostgreSQL schema. A fresh-database migration system is not included yet.
- Credential compatibility: existing encrypted session cookies, personal access tokens, bcrypt hashes, and encrypted custom fields remain readable when the matching `APP_KEY` is supplied.

## Stack

- Node.js 22
- Next.js 16 and React 19
- TypeScript 6
- PostgreSQL 17
- Drizzle ORM
- Redis and BullMQ
- Resend for production email delivery
- Vitest

## API

Public endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/up` | Process liveness |
| `GET` | `/health/ready` | PostgreSQL and Redis readiness |

Authenticated endpoints:

| Methods | Path |
| --- | --- |
| `GET` | `/api/v1/user` |
| `GET`, `POST` | `/api/v1/companies` |
| `GET`, `PUT`, `PATCH`, `DELETE` | `/api/v1/companies/{companyId}` |
| `GET`, `POST` | `/api/v1/people` |
| `GET`, `PUT`, `PATCH`, `DELETE` | `/api/v1/people/{personId}` |
| `GET`, `POST` | `/api/v1/opportunities` |
| `GET`, `PUT`, `PATCH`, `DELETE` | `/api/v1/opportunities/{opportunityId}` |
| `GET`, `POST` | `/api/v1/tasks` |
| `GET`, `PUT`, `PATCH`, `DELETE` | `/api/v1/tasks/{taskId}` |
| `GET`, `POST` | `/api/v1/notes` |
| `GET`, `PUT`, `PATCH`, `DELETE` | `/api/v1/notes/{noteId}` |

Authentication supports existing personal access tokens and database-backed encrypted sessions. A token-bound workspace takes precedence over `X-Team-Id`, which takes precedence over the user's current workspace.

## Requirements

- Node.js `>=22.12.0`
- npm
- PostgreSQL with the existing Relaticle schema
- Redis

## Local Setup

```bash
git clone https://github.com/wasmake/relaticle-next.git
cd relaticle-next
npm ci
cp .env.example .env
```

Configure PostgreSQL and Redis in `.env`, then start the API:

```bash
npm run dev
```

The development server listens on `http://localhost:3000` by default.

Build and run the worker separately when testing task notifications:

```bash
npm run build:worker
npm run start:worker
```

## Environment

The complete template is in `.env.example`. The principal variables are:

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Public application URL |
| `APP_KEY` | Existing encrypted-cookie and custom-field compatibility |
| `APP_PREVIOUS_KEYS` | Previous encryption keys used during rotation |
| `DATABASE_URL` or `DB_*` | PostgreSQL connection |
| `REDIS_URL` or `REDIS_*` | Redis connection |
| `REDIS_CACHE_DB` | API rate-limit database, default `1` |
| `BULLMQ_PREFIX` | BullMQ key prefix |
| `REQUIRE_EMAIL_VERIFICATION` | Require verified users for API access |
| `RELATICLE_FEATURE_BILLING` | Enable hosted-workspace subscription enforcement |
| `MAIL_MAILER` | Worker mail transport: `log` or `resend` |
| `RESEND_KEY` | Required when `MAIL_MAILER=resend` |

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js development server |
| `npm run build` | Build the Next.js server and BullMQ worker |
| `npm run start` | Start the production Next.js server locally |
| `npm run start:worker` | Start the compiled BullMQ worker |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Type-check web, worker, and scheduler contracts |
| `npm test` | Run the Vitest suite |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run check` | Run lint, type checks, tests, and production builds |

## Docker

The Node-only image contains both the standalone Next.js server and compiled worker. Compose runs the same image with separate commands:

```bash
DB_PASSWORD=change-me docker compose up --build
```

Services:

- `web`: Next.js on port `3000`
- `worker`: BullMQ default-queue worker
- `postgres`: PostgreSQL 17
- `redis`: Redis 7

Compose does not initialize the application schema. Restore or connect an existing compatible database before using the CRM endpoints.

## Architecture

```text
apps/
  web/          Next.js routes, API services, database mappings
  worker/       BullMQ task-notification worker
  scheduler/    Schedule contracts only; no runtime yet
packages/
  queue/        Shared queue names, job schemas, and schedule contracts
tests/
  next/         Vitest API and compatibility tests
```

Each CRM route follows the same path: App Router handler, access resolver, validation, service, repository, Drizzle query, and JSON:API-style response formatter.

## Verification

```bash
npm ci
npm run check
npm audit --audit-level=moderate
```

## Known Limitations

- No browser UI or browser authentication flow is implemented.
- No Node database migrations are included.
- The worker currently processes task-assignment jobs on the `default` queue only.
- The declared `imports` and `chat` queues do not have Node processors.
- Scheduler contracts exist, but scheduled job handlers and a scheduler process do not.
- File-upload custom fields are rejected until a Node media lifecycle is implemented.
- Live PostgreSQL, Redis, BullMQ, and Resend integration requires a production-shaped environment.

## License

Relaticle Next is licensed under the [GNU Affero General Public License v3.0](LICENSE).
