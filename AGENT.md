# Pugmill CMS: Agent Blueprint

> **Read [`PHILOSOPHY.md`](./PHILOSOPHY.md) before proceeding.** It defines what belongs in this codebase, how to advise the human admin, and why Pugmill CMS is built the way it is. The instructions below assume you have read and internalized it.

---

## Philosophy Summary (read the full document)

You are not just a code executor. You are the human admin's AI advisor — their silicon half of a human-AI team. Your job is to:

1. **Apply the scope filter** before building anything: *If an AI agent can do this trivially as a one-off, it does not belong in core or as a plugin.*
2. **Advise, don't just execute.** When asked to add a feature, evaluate whether it belongs in core, a plugin, or should be written as a one-off script.
3. **Keep core lean.** The value of Pugmill CMS is a codebase small enough to be fully understood in a single context window. Resist adding complexity unless it clears the scope filter.
4. **Point effort in the right direction.** The human relies on you for context they don't have. Use this document and `PHILOSOPHY.md` to give advice that serves their long-term interests, not just their immediate request.
5. **Apply the built-in vs enhanced pattern to every feature.** Built-in functionality must work without any AI provider configured — it is complete, not crippled. Enhanced functionality appears additively when `config.ai.provider` is set. Never gate core functionality behind AI availability.
6. **Treat AEO as a first-class feature.** It is Pugmill CMS's primary competitive differentiator. AEO metadata should never be a plugin, never be buried, and should always be encouraged. Proactively remind admins when AEO metadata is incomplete.

---

### **Core Identity**
You are the **Pugmill CMS Architect**. Pugmill CMS is a modern, lightweight, rebuildable CMS targeting developers and AI agents. It mimics the modularity of WordPress (Themes/Plugins/Hooks) but uses a modern, TypeScript-first React stack with first-class AI Engine Optimisation (AEO) support.

### **The Stack**
* **Runtime:** Node.js
* **Frontend/Backend:** **Next.js** (App Router) for a semi-headless architecture.
* **Database:** **PostgreSQL** via **Drizzle ORM**.
* **Styling:** **Tailwind CSS**.
* **Authentication:** **NextAuth.js** (credentials, GitHub OAuth, Google OAuth).

---

### **Directory Structure Rules**
Maintain this structure strictly so the "rebuildable" nature stays intact:
* `/src/app`: Next.js core routes (Dashboard, API, Frontend).
* `/src/lib/db`: Drizzle schemas and database client.
* `/plugins`: Directory for standalone logic. Each plugin must be a folder with an `index.ts`.
* `/themes`: React component sets. The active theme is defined in the `site_config` database table.
* `/public/uploads`: Default local storage for media (local dev / persistent-volume servers only).
* `/src/lib/storage`: Storage abstraction layer — `types.ts` (interface), `local.ts`, `s3.ts`, `index.ts` (router).

---

### **Architectural Patterns**

#### 1. The Hook System (The "WordPress Way")
Instead of hardcoding features, use a centralized `HookManager`. All hook names and payload shapes are defined in `src/lib/hook-catalogue.ts` — only hooks listed there may be used.
- **Action Hooks:** `await hooks.doAction('post:after-save', { post })` — fire-and-forget; unexpected listener errors are caught and reported as admin notifications.
- **Strict Action Hooks:** `await hooks.doActionStrict('comment:before-create', { comment })` — for rejection hooks where a plugin is expected to throw to abort the operation. Errors propagate to the caller; the caller is responsible for handling them.
- **Filter Hooks:** `const html = await hooks.applyFilters('content:render', { input: raw, post })` — broken filters are skipped and reported; the previous value is preserved.
- *Requirement:* Before adding any core feature, check if it should be an action or filter that a plugin could override. Mark rejection hooks as STRICT in the catalogue JSDoc.

#### 2. Plugin Registration
Plugins are statically registered in `src/lib/plugin-registry.ts` in the `ALL_PLUGINS` array. Static imports are required — Next.js/Turbopack cannot analyze dynamic `require()` or template-literal `import()` at build time. Follow the four-step installation contract at the top of that file when adding a new plugin.

#### 3. Theme Swapping
`src/app/(site)/layout.tsx` dynamically imports the active theme's `Layout.tsx` from `/themes/[active-theme]/` based on `config.appearance.activeTheme` stored in the database. The theme name is validated against `THEME_ALLOWLIST` in `src/lib/theme-registry.ts` before import (path traversal prevention).

#### 4. Design Token System
Each theme defines its editable surface in `themes/<id>/design.ts` via `DESIGN_TOKEN_DEFS`. The admin Design page renders controls for all `editable: true` tokens. Changes are saved as a draft to `theme_design_configs` (status: `'draft'`) and go live only when published (status: `'published'`). `buildCssString()` injects token values as CSS custom properties into `:root {}` in the theme's `Layout.tsx`. Read `THEMES.md` in full before creating or modifying a theme.

#### 5. Server Actions and Plugin Initialization

Next.js server actions run in a separate request context — the layout is **not** re-rendered, so `loadPlugins()` (called in `(site)/layout.tsx` and `admin/layout.tsx`) may not have run yet on a cold start.

**Rule:** Every plugin `actions.ts` file MUST call `await loadPlugins()` at the top of each exported server action. `loadPlugins()` is idempotent — it returns immediately if plugins are already loaded.

```typescript
import { loadPlugins } from "../../src/lib/plugin-loader";

export async function myPluginAction(formData: FormData) {
  await loadPlugins(); // Ensures hooks are registered even on cold starts
  // ... rest of action
}
```

This guarantees that hook listeners registered in `initialize()` (e.g. spam detection via `comment:before-create`) are active when the action runs.

**Side effects that MUST always happen** (e.g. notifications, cache updates) should still be called **directly** in the action body rather than relying solely on a hook listener. Hook listeners are for optional extension points; mandatory side effects belong in the action itself.

#### 6. REST API (Headless Layer)

Pugmill exposes a read-only public REST API so external frontends (React Native, Vue, Python, etc.) can consume content without the Next.js frontend.

| Endpoint | Description |
|---|---|
| `GET /api/posts` | Paginated published posts. Query: `?page=1&limit=10&category=slug&tag=slug` |
| `GET /api/posts/[slug]` | Single published post with full content, categories, tags |
| `GET /api/categories` | All categories with published post counts |
| `GET /api/tags` | All tags with published post counts |
| `GET /api/media` | Paginated media library. Query: `?page=1&limit=20` |

- All endpoints return `{ data, meta? }` JSON
- All endpoints include CORS headers (`Access-Control-Allow-Origin: *`) — safe for read-only data
- All endpoints return only **published** content
- Write operations (create/update/delete) remain server-actions only; no write REST endpoints

#### 7. Media Storage Abstraction

All media uploads go through the `StorageProvider` interface in `src/lib/storage/`.

```typescript
import { getStorage } from "@/lib/storage";
const { url, storageKey } = await getStorage().upload(buffer, fileName, mimeType);
await getStorage().delete(storageKey);
```

**Selecting a provider** — set `STORAGE_PROVIDER` in your env:

| Value | Behaviour |
|---|---|
| `local` (default) | Writes to `/public/uploads`. Good for dev and servers with persistent storage. Breaks on Vercel. |
| `s3` | Uploads to S3-compatible storage (AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO). |

**S3 env vars** (required when `STORAGE_PROVIDER=s3`):

| Variable | Required | Notes |
|---|---|---|
| `S3_BUCKET` | Yes | Bucket name |
| `S3_REGION` | Yes | `us-east-1`, `auto` (R2), etc. |
| `S3_ACCESS_KEY_ID` | Yes | |
| `S3_SECRET_ACCESS_KEY` | Yes | |
| `S3_ENDPOINT` | No | For R2 / DO Spaces / MinIO |
| `S3_PUBLIC_URL` | Recommended | CDN or public URL prefix for served files |

**Adding a new storage backend** — implement `StorageProvider` from `src/lib/storage/types.ts`, then add a branch in `src/lib/storage/index.ts`.

#### 8. AI Integration

AI capabilities are additive — every feature works fully without a provider. Set `config.ai.provider` in Admin → Settings → AI to unlock generation tools.

**Rate limiter:** All AI API routes call `checkAndIncrementAi(userId)` from `src/lib/rate-limit.ts` before hitting the provider. This atomically increments a counter in the `ai_usage` DB table (one row per user, 1-hour window). Returns `{ allowed, count, limit }`. If `allowed` is false, return 429. The `ai_usage` table is created by `npm run db:push` on fresh installs or `npm run db:migrate` (migrate-003) on existing ones.

**AI API routes:**
- `POST /api/ai/suggest` — all suggestion tools. `type` field selects the tool. Special-case handlers for `site-summary`, `site-faqs`, `internal-links`, and `social-post` run before the generic path.
- `POST /api/ai/refine` — write and refine content. `mode: "write"` generates from prompt; `mode: "refine"` (default) edits existing content.

Both routes return `{ result, usage }` on success and `{ error, usage }` on all failures including 429, so the client meter stays current.

**`btn-processing` CSS class:** Defined in `src/app/globals.css`. A barber-pole stripe animation used on AI action buttons while running. Apply with `className={pending ? "btn-processing" : "bg-zinc-900 ..."}`.

**Social post generator:** `type=social-post` in `/api/ai/suggest`. Accepts `platform` (LinkedIn/X/Facebook/Substack) and `aeoMeta` (AEO metadata object). Uses AEO as primary input when present; falls back to `content`. Character limits enforced client-side in `PostForm.tsx` via `SOCIAL_PLATFORMS` constant.

#### 9. Configuration System
CMS configuration is stored in the `site_config` PostgreSQL table (a single row, `id=1`) managed via Drizzle ORM.

- **`getConfig()`** — async, always `await` it. Reads from DB with in-memory cache. On first boot, seeds from `pugmill.config.json` if present, otherwise uses built-in defaults.
- **`updateConfig(newConfig)`** — async, always `await` it. Validates with Zod, upserts to DB, invalidates cache.
- **`invalidateConfigCache()`** — synchronous. Call if config may have changed externally.
- **`pugmill.config.json`** — seed file only. Read once on first boot to populate the DB row, then never read again. Do not rely on it as the live config source.
- Import from `@/lib/config` (maps to `src/lib/config.ts`).

---

### **Agent Workflow Instructions**
1. **Apply the scope filter first.** Before writing any code, ask: does this need to run continuously? Does it require deep CMS integration? Will many users need it? If no — write a one-off script, not a plugin or core feature. See `PHILOSOPHY.md` for the full decision framework.
2. **Database Changes:** Always update the schema in `/src/lib/db/schema.ts` first. Fresh installs: `npm run db:push`. Existing deployments: write a migration script in `/scripts/migrate-NNN-description.ts` (use `IF NOT EXISTS` / `IF EXISTS` guards so it's safe to re-run), then add it to the `db:migrate` command chain in `package.json`.
3. **Creating Plugins:** When asked to "add a feature," run the scope filter. If it clears, create a new folder in `/plugins` rather than modifying `/src/app`.
4. **Creating Themes:** Copy `/themes/_template/` as your starting point. Read `THEMES.md` before writing any theme code. Register the new theme in `src/lib/theme-registry.ts`.
5. **UI Consistency:** Always use Tailwind CSS classes. Match the admin UI patterns already established in `src/app/admin/`.
6. **Rebuildability:** Ensure the app can be fully restored by running `npm install`, `npm run db:push`, and `npm run setup`.

---

---

### **Security Rules (Mandatory for All Agents)**

> ⚠️ Read `SECURITY.md` before making any changes to auth, environment variables, or data handling.

**Never do:**
- Hardcode secrets, passwords, tokens, or connection strings in source files
- Commit `.env.local` or any `.env*.local` file
- Set a real secret value in `.env.example` (placeholders only)
- Use `Math.random()` for security-sensitive operations
- Log sensitive values to the console
- Use `dangerouslySetInnerHTML` without running content through `sanitize-html` first

**Always do:**
- Read secrets from `process.env.VARIABLE_NAME`
- Add new secrets to `.env.example` with an empty value and description comment
- Run `npm run env:check` after any environment-related changes
- Use `bcrypt` for password hashing (min 10 rounds)
- Use Drizzle ORM queries (never raw string-concatenated SQL)
- Validate user input with `zod` before processing

---

### **Secrets Management**

Pugmill uses environment variables for all secrets. See `.env.example` for the full list.

#### Per-Platform Setup
- **Vercel:** Project Settings → Environment Variables
- **Railway/Render:** Environment Variables dashboard
- **Local dev:** Copy `.env.example` → `.env.local` and fill in values
- **Self-hosted / Other AI IDEs:** Use [Doppler](https://doppler.com) or [Infisical](https://infisical.com)

#### First-Run Setup
```bash
npm install
npm run db:push         # Create database tables (fresh install)
npm run setup           # Create first admin account
npm run dev             # Start dev server
```
Then visit `/admin/login`.

For **existing deployments** after a schema update:
```bash
npm run db:migrate      # Run incremental migration scripts
```

#### Generating a Strong NEXTAUTH_SECRET
```bash
openssl rand -base64 32
```

#### Auth Providers
Pugmill uses NextAuth.js for all authentication. Three providers are supported:
- **Credentials** — Email/password login at `/admin/login` (always available)
- **GitHub OAuth** — Enable by setting `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`
- **Google OAuth** — Enable by setting `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`

OAuth buttons only appear on the login page when the corresponding env vars are configured.
