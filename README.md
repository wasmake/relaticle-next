# Relaticle Next

Relaticle Next is the Node.js edition of Relaticle, an open-source relationship workspace for companies, people, opportunities, tasks, notes, and AI-assisted work. The application is implemented with Next.js, React, PostgreSQL, Redis, BullMQ, and Drizzle ORM.

This repository contains no PHP runtime or Composer dependencies.

## Product

- Browser authentication, registration, password reset, email verification, social login, remember-me sessions, and two-factor authentication.
- Workspace onboarding, switching, invitations, membership roles, profiles, session management, deletion workflows, and notification preferences.
- Company, people, opportunity, task, and note lists, details, editing, trash/restore, activity timelines, global search, and task/opportunity boards.
- Dynamic custom-field sections, definitions, options, validation, encrypted values, record fields, and file uploads.
- CSV import/export with validation, relationship columns, custom fields, history, failed rows, and durable workers.
- AI chat with conversations, streaming providers, mentions, feedback, credits, cancellation, CRM tools, and approval-gated writes.
- Personal access tokens, OAuth 2.1 discovery/registration/PKCE/refresh/revocation, and a workspace-bound MCP JSON-RPC server.
- Stripe-compatible trials, subscriptions, portal, credit packs, webhooks, and hosted-workspace access enforcement.
- Public marketing, pricing, contact, legal, comparison, documentation, help, blog, RSS, sitemap, and SEO surfaces.
- System administration for users, workspaces, CRM data, imports, billing, activity, AI usage, administrators, and blog authoring.
- Node-owned PostgreSQL migrations, BullMQ workers for `default`, `imports`, and `chat`, and a cluster-safe scheduler.

Existing Relaticle credentials remain compatible when the original `APP_KEY` is configured: encrypted session cookies, bcrypt hashes, personal access tokens, and encrypted custom-field values can continue to be used.

## Stack

- Node.js 22
- Next.js 16 and React 19
- TypeScript 6
- PostgreSQL 17 and Drizzle ORM
- Redis 7 and BullMQ
- Resend or log email delivery
- Vitest and Playwright

## Requirements

- Node.js `>=22.12.0`
- npm
- PostgreSQL 17+
- Redis 7+

## Local Setup

```bash
git clone https://github.com/wasmake/relaticle-next.git
cd relaticle-next
npm ci
cp .env.example .env
npm run db:migrate
npm run dev
```

Run the worker and scheduler in separate terminals:

```bash
npm run build:worker
npm run start:worker
```

```bash
npm run build:scheduler
npm run start:scheduler
```

The browser application is available at `http://localhost:3000`.

## Environment

The complete template is in `.env.example`.

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Public application URL |
| `APP_KEY` | Current 32-byte application encryption key |
| `APP_PREVIOUS_KEYS` | Previous encryption keys used during rotation |
| `DATABASE_URL` or `DB_*` | PostgreSQL connection |
| `REDIS_URL` or `REDIS_*` | Redis, cache, queue, lock, and health connections |
| `MAIL_MAILER` | `log` or `resend` |
| `RESEND_KEY` | Resend API key when email delivery is enabled |
| `OPENAI_API_KEY` | OpenAI chat provider |
| `ANTHROPIC_API_KEY` | Anthropic chat provider |
| `OLLAMA_URL` | Ollama endpoint for self-hosted chat |
| `GITHUB_CLIENT_ID/SECRET` | GitHub browser authentication |
| `GOOGLE_CLIENT_ID/SECRET` | Google browser authentication |
| `TURNSTILE_SITE_KEY/SECRET_KEY` | Registration abuse protection |
| `STRIPE_*` | Billing API, webhook, product, and price configuration |
| `MAILCOACH_*` | Optional subscriber synchronization |

External integrations are enabled only when their credentials are configured.

## API And MCP

The REST API is rooted at `/api/v1` and supports users, companies, people, opportunities, tasks, notes, custom-field metadata, media, personal access tokens, and import/export jobs. Core CRM resources expose collection `GET`/`POST` and record `GET`/`PUT`/`PATCH`/`DELETE` operations.

Authentication supports encrypted database sessions, workspace-bound personal access tokens, and OAuth bearer tokens. Token abilities are `read`, `create`, `update`, and `delete`.

OAuth and MCP endpoints:

| Path | Purpose |
| --- | --- |
| `/.well-known/oauth-authorization-server` | OAuth authorization-server metadata |
| `/.well-known/oauth-protected-resource/mcp` | MCP protected-resource metadata |
| `/oauth/register` | Dynamic client registration |
| `/oauth/authorize` | Workspace consent and authorization code |
| `/oauth/token` | PKCE code and refresh-token exchange |
| `/oauth/revoke` | Token revocation |
| `/mcp` | MCP JSON-RPC transport |

The MCP server exposes identity, search/fetch, CRM summary, schema resources, an overview prompt, CRUD tools for all core entities, and task/note attachment tools.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js development server |
| `npm run build` | Build web, worker, and scheduler artifacts |
| `npm run start` | Start the production Next.js server locally |
| `npm run start:worker` | Start all BullMQ queue workers |
| `npm run start:scheduler` | Start the cluster-safe scheduler |
| `npm run db:generate` | Generate a Drizzle migration from schema changes |
| `npm run db:migrate` | Apply pending PostgreSQL migrations |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Type-check web, worker, and scheduler projects |
| `npm test` | Run Vitest |
| `npm run test:e2e` | Run Playwright on desktop and mobile Chromium |
| `npm run check` | Run lint, types, unit tests, and production builds |

## Docker

```bash
DB_PASSWORD=change-me APP_KEY=base64:... docker compose up --build
```

Compose starts:

- `migrate`: applies the Node-owned schema before application startup
- `web`: standalone Next.js server on port `3000`
- `worker`: `default`, `imports`, and `chat` BullMQ workers
- `scheduler`: distributed scheduled-job runtime
- `postgres`: PostgreSQL 17
- `redis`: Redis 7

The `storage` volume is shared by web, worker, and scheduler for private media and import/export artifacts.

## Architecture

```text
apps/
  web/          Browser UI, REST API, OAuth, MCP, domain services
  worker/       BullMQ processors and outbound integrations
  scheduler/    Cadence, distributed locks, and scheduled operations
packages/
  queue/        Shared queue, job, and schedule contracts
drizzle/        Node-owned PostgreSQL migrations
tests/
  next/         Vitest domain, API, worker, and scheduler tests
  e2e/          Playwright browser tests
```

HTTP features follow the same boundary: route handler, authentication and tenant policy, validation, domain service, repository, Drizzle query, and response formatter. Browser server actions call the same domain services rather than bypassing API behavior.

## Verification

```bash
npm ci
npm run db:migrate
npm run check
npm run test:e2e
npm audit --audit-level=moderate
npm audit --omit=dev --audit-level=moderate
DB_PASSWORD=test docker compose config --quiet
```

Playwright CI provisions PostgreSQL and Redis, applies the migration baseline, seeds an isolated workspace, builds the production server, and executes the browser suite with failure traces, screenshots, and video artifacts.

## License

Relaticle Next is licensed under the [GNU Affero General Public License v3.0](LICENSE).
