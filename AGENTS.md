# AGENTS.md — tavern-home

Cloudflare Workers (`examples/cloudflare/index.ts`) + Next 16 App Router (`frontend/app/study/`). All user data in local D1 (SQLite dialect via `wrangler d1`). `README.md` + `docs/data-model.md` are canonical; this file is only the non-obvious traps.

## Commands (repo root)

- `npm run dev` → `wrangler dev` (default 8787). Daily ports are **8799/3001** via `run.bat`: `npx wrangler dev --port 8799 --ip 0.0.0.0` + `frontend/.bin/next dev -p 3001 -H 0.0.0.0`
- `npm run typecheck` → `tsc --noEmit` (root, covers `src/` + `examples/`)
- `npm test` → `node --test tests/*.test.ts` (no framework). Single: `node --test tests/<name>.test.ts`
- `npm run build` → `node scripts/run-wrangler.mjs deploy --dry-run --outdir dist` (wraps wrangler with `.tmp-wrangler-config` + isolated `XDG_CONFIG_HOME`)
- Frontend: `cd frontend && npm run build` — must be `next build --webpack` (see `frontend/package.json`), `npm run lint` (eslint), `npx tsc --noEmit` for frontend typecheck
- Full check: `npm run release:check` = `typecheck && test && build && node scripts/release-hygiene.mjs`. CI (`.github/workflows/ci.yml`, Node 24, push/PR→main) runs `npm ci` + backend typecheck + `npm test` + frontend `tsc --noEmit` (not full build)
- DB: `npm run db:init:local` (exec `examples/cloudflare/schema/init.sql` on empty DB), `npm run db:migrate:local` (apply `examples/cloudflare/schema/migrations/`). `run.bat` only runs `init` once (guarded by `.local-db-initialized`), migrations are **never auto-applied**

## Architecture boundaries

- Backend entry `examples/cloudflare/index.ts` — **every API is under `/{AUTH_TOKEN}/api/oc/...`**; missing token → 401. MCP + published-reading routes use Bearer `OWNER_TOKEN`/`COMPANION_TOKEN` instead.
- Pure logic `src/core/` + `src/tools/` + `src/chat/desk.ts` + `src/adapters/streamModelBackends.ts`; D1 adapters `examples/cloudflare/adapters/d1*.ts` are reference dialect only. Contract is `StorageAdapter`/`DeskStorage` in `src/core/storage.ts` + types in `src/core/types.ts` — D1 column names are not the contract.
- Frontend lives entirely in `frontend/app/study/`: `page.tsx` (room router), `TypingDesk.tsx` (desk + provider switch), `ChaptersStudio.tsx`, `ReadingCorner.tsx`, etc. New rooms need an entry in `page.tsx`.
- Generation chains (desk chat / `deskTimeline.ts` fold / `refreshDeskBoard`) all share the same provider routing — don't duplicate it.

## Config & secrets (all gitignored)

- Root `.dev.vars`: `AUTH_TOKEN` (path token) / `OWNER_TOKEN` / `COMPANION_TOKEN` + vendor keys `<PREFIX>_API_KEY/_BASE_URL/_MODEL`. `frontend/.env.local` = `NEXT_PUBLIC_WORKER_URL=http://localhost:8799` + `NEXT_PUBLIC_AUTH_TOKEN` (inlined at build time — rebuild frontend after change).
- `COMPANION_COMMENT_WRITE` is a var in `wrangler.toml` (`"false"`=read-only, `"true"` allows companion to post `oc_comments`). Not a secret.
- `[vectorize]`/`[ai]` bindings are **commented out in `wrangler.toml` on purpose** — enabling them makes `wrangler dev` require `CLOUDFLARE_API_TOKEN` and fail locally. Vectorize/semantic recall degrades gracefully (`StudyService` capability `'disabled'`, past-chapters section empty).
- `.local-db-initialized` guards DB init; `.wrangler/state/v3/d1/` is the local D1; `.tmp-*` / `dist/` / `.wrangler/` are scratch (gitignored). Delete `.wrangler/` + `.dev.vars` + `frontend/.env.local` + `.local-db-initialized` to factory-reset.

## Schema — the one rule that fails CI

- `examples/cloudflare/schema/init.sql` **must be byte-identical to the concatenation of `examples/cloudflare/schema/migrations/*.sql` sorted by name** (enforced by `tests/schemaContract.test.ts`). Change init → add a matching migration; never edit init alone. Migrations dir is set in `wrangler.toml` (`migrations_dir`).
- D1 conventions: booleans `INTEGER CHECK(x IN (0,1))`, JSON `TEXT` (stringified arrays/objects), timestamps ISO strings. Forwarded indexes/triggers (e.g. `comment_rate_buckets`, `comments_reply_same_chapter_*`) are part of the reference dialect.

## Provider routing (single source of truth)

- Registry `DESK_PROVIDER_DEFS` in `src/adapters/streamModelBackends.ts` (opencode/anthropic/deepseek/siliconflow by env prefix). No provider → legacy `OPENAI_*`→Anthropic fallback.
- "Configured?" is `deskProviderConfigured`/`resolveDeskProvider`/`listProviders` **only** — they share `isPlaceholderKey()` which filters `put-your-...-here` placeholder values. Never check `env[KEY] !== ''` alone. Unconfigured desk returns clean 500, **no silent fallback**.
- Browser persistence `localStorage.oc_desk_provider`; `GET /api/oc/desk/providers` lists configured providers.

## Testing quirks

- Runner is `node:test` + `node:assert/strict` (ESM, `allowImportingTsExtensions: true`). Isolation is per-test via `wrangler.test.toml` + `--persist-to .tmp-wrangler-*` + `XDG_CONFIG_HOME=.tmp-wrangler-config` (see `tests/schemaContract.test.ts:10` and `scripts/run-wrangler.mjs`).
- `tests/schemaContract.test.ts` creates two real D1 instances (init + migrations) with 30s timeout; needs 60s overall. Most other tests emit expected `TypeError: Cannot read properties of undefined (reading 'prepare'/'run')` logs when testing without D1 — that's intentional fallback, not failure.
- `scripts/release-hygiene.mjs` walks the entire repo (skips `node_modules/.git/dist/.next/.wrangler`, `package-lock.json`, binary extensions) and fails on committed `.env`/`.pem`/`.key` or private names/tokens (`sk-ant-`, `gh*_`). Add legitimate hits to `allowlist`, not by deleting the needle.

## Gotchas that break first run

- `run.bat` **must stay pure ASCII, no BOM, no Chinese** — `cmd` parses it as GBK and a BOM kills `@echo off`. It also uses `!AUTH_TOKEN!` delayed expansion inside `if (...)` blocks; `%AUTH_TOKEN%` expands too early.
- System `HTTP_PROXY`/`HTTPS_PROXY=http://127.0.0.1:10809` breaks `npm install` (404 via bad proxy) and can hang model calls. Clear both envs and force registry: `set HTTP_PROXY=& set HTTPS_PROXY=& npm install --registry=https://registry.npmjs.org` (already done in `run.bat`).
- Node ≥ 18.18 required (CI uses 24). Frontend copy is Chinese — keep new UI in Chinese.
- CRLF warnings (`LF will be replaced by CRLF`) on `git add` are expected on Windows; don't chase them.
