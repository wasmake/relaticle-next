# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Added a standalone Next.js application under `apps/web` using Next.js 16, React 19, and TypeScript 6.
- Added PostgreSQL and Redis clients, environment validation, readiness endpoints, and Drizzle mappings for the existing application tables.
- Added compatibility with existing Laravel application keys, encrypted cookies, database sessions, Sanctum tokens, and bcrypt credentials.
- Added tenant-scoped REST endpoints for users, companies, people, opportunities, tasks, and notes.
- Added custom-field validation, encryption, formatting, option handling, and atomic EAV persistence for migrated REST writes.
- Added hosted-workspace subscription enforcement with Laravel Cashier-compatible trial, grace-period, past-due, grandfathered, Pro, and Enterprise behavior.
- Added Laravel-compatible REST API rate limiting with workspace and credential buckets stored in Redis.
- Added transactional CRM activity logging for native and custom-field changes across companies, people, opportunities, tasks, and notes.
- Added BullMQ queue contracts and a production Node worker for task-assignment database notifications and Resend email delivery.
- Added Next.js and worker build scripts, a Node-only production image, and separate Compose web and worker services.
- Added TypeScript workflow and compatibility coverage under `tests/next`.

### Changed

- Removed the PHP application, Composer dependencies, legacy Vite build, PHP tests, and PHP-specific tooling.
- Moved retained static assets into `apps/web/public`.
- Replaced PHP-oriented CI workflows with Node checks, npm security audits, and Node image publishing.
- Updated task-assignment jobs to use versioned payloads, event-scoped job IDs, stable notification IDs, and idempotent Resend requests.
- Updated the production image to run the generated standalone Next.js server and compiled Node worker.

### Fixed

- Prevented BullMQ from opening a Redis connection during the Next.js production build.
- Preserved signed 64-bit custom-field values without JavaScript rounding.
- Prevented partial custom-field updates from clearing omitted values.
- Prevented former workspace members from leaking through creator relationships.
- Added same-origin protection for session-authenticated API writes.
- Corrected opportunity ordering and note timestamps for relationship-only updates.
- Ensured Next-created and updated opportunities produce activity records used by stale-opportunity filtering.

### Verification

- `npm run check` passes with 226 tests across 16 test files.
- Next.js and Node worker production builds pass.
- `npm audit` reports zero known vulnerabilities.
- Docker Compose configuration validation passes.

### Known Limitations

- No browser CRM or authentication UI is implemented yet.
- A fresh-database migration system is not implemented; an existing compatible PostgreSQL schema is required.
- Live PostgreSQL, Redis, BullMQ, and Resend integration requires a configured production-shaped environment.
- Company favicon fetching and first-CRM-data subscriber tagging are not yet implemented in the Next.js write path.
- Remaining product areas, including chat, imports, MCP, OAuth, billing UI, documentation, blog, and system administration, are not implemented.
