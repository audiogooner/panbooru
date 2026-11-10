# Panbooru

Single-owner gallery. The app is SvelteKit with Svelte 5 runes, the Node adapter, SQLite through better-sqlite3 and Drizzle, and a master key that encrypts Gelbooru credentials.

## Layout

- Application code is `panbooru/`. Run npm scripts from that directory.
- Routes and pages: `panbooru/src/routes/`.
- Shared UI and client state: `panbooru/src/lib/`. Shared state modules are `*.svelte.ts`.
- Server code: `panbooru/src/lib/server/` (auth, database, library, media, sources).
- The HTTP API is `dispatch()` in `panbooru/src/lib/server/auth/dispatch.ts`. `src/hooks.server.ts` loads services, reads the session, answers `GET /health`, then calls `dispatch`. Add API behavior there. `+server.ts` is only for the health exception.
- Product intent is the markdown directly under `plan/`: `Panbooru-Specification.md`, `Panbooru-UI-Decisions.md`, `Panbooru-Design-Handoff.md`, and `Panbooru-Album-Fan-Specification.md`. `plan/*-Bundle` and `plan/panbooru-ui` are frozen copies.

## Commands

From `panbooru/`:

- `npm run dev` — local app. Copy `.env.example` to `.env` first.
- `npm run check` — `svelte-kit sync` and `svelte-check`.
- `npm run test:unit -- --run` — Vitest. Pass a spec path while iterating.
- `npx playwright test src/routes/<name>.e2e.ts` — one end-to-end file. `npm run test:e2e` rebuilds and also installs browsers.

## Invariants

- Never commit `.env`, `panbooru/data/`, key files, or Playwright `test-results`.
- Do not log passwords, session tokens, Gelbooru user ids, API keys, or secret paths. Run upstream URLs through `redactSecrets` in `src/lib/server/http/redact.ts`.
- `GET /health` returns no paths or secrets. `GET /api/ready` is authenticated.
- If saved Gelbooru credentials exist, a missing or wrong master key must not be replaced with a newly generated key.
- Opening a database whose `schema_migrations` version is newer than `SCHEMA_VERSION` must fail. A schema change bumps that constant and appends a migration in `src/lib/server/db/index.ts`.
- Media fetches stay on `allowHosts` / `PANBOORU_MEDIA_HOSTS`.
- `src/routes/layout.css` holds the shared visual tokens. Change it only when the task is those tokens.
- Formatting is Prettier: tabs, single quotes, no trailing commas, print width 100. Imports use `#lib/...` and include the extension (`#lib/server/app.ts`).
