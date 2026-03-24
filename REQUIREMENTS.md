# Pugmill — Product Requirements

**Version:** 0.1 Developer Preview
**Status:** Build-clean, pre-launch
**Last updated:** 2026-03-14

---

## 1. Overview

Pugmill is an AI-native, semi-headless content management system built on Next.js. It targets developers and AI agents who want a fully rebuildable CMS with first-class support for modern publishing workflows, structured AI discoverability (AEO), and a commercial open-source business model.

**Strategic pillars:**

| Pillar | Description |
|---|---|
| Rebuildable | Any AI IDE or developer can reconstruct the site from the codebase alone, without manual intervention |
| AEO-native | Content is structured and exposed in formats AI engines can crawl, cite, and understand |
| Headless-ready | A public REST API allows external frontends to consume content independently |
| Extensible | WordPress-style Hook/Filter system and plugin architecture allow feature addition without modifying core |

**Business model:** MIT-licensed open-source core. Proprietary marketplace for themes and plugins planned for v1.0+. Distribution via npm (private registry, license-key auth) with AI agent-assisted installation. Managed hosting planned for v1.0+.

---

## 2. Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | ^16 |
| Language | TypeScript | ^5.7 |
| Database | PostgreSQL | 14+ |
| ORM | Drizzle ORM | ^0.38 |
| Auth | NextAuth v5 (beta) | 5.0.0-beta.30 |
| Styling | Tailwind CSS | ^3.4 |
| Editor | Tiptap + tiptap-markdown | ^3 / ^0.9 |
| Markdown renderer | react-markdown + remark-gfm + rehype | ^10 |
| Storage SDK | AWS SDK v3 (`@aws-sdk/client-s3`) | ^3 |
| Validation | Zod | ^3.24 |
| Password hashing | bcryptjs | ^3 |
| HTML sanitisation | rehype-sanitize | ^6 |
| Rate limiting | lru-cache | ^11 |
| Deployment target | Vercel, Railway, Render, self-hosted Node | — |

---

## 3. Authentication Requirements

### 3.1 Providers
- **Credentials** — email + password login. Always available. Passwords hashed with bcryptjs (12 rounds).
- **GitHub OAuth** — enabled when `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set.
- **Google OAuth** — enabled when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set.
- OAuth provider buttons render on the login page only when the corresponding env vars are configured.

### 3.2 Session strategy
- JWT sessions (stateless). No DB round-trip on authenticated requests.
- Custom `id` and `role` fields typed via NextAuth module augmentation (`src/types/next-auth.d.ts`).
- Session carries: `id` (UUID string), `name`, `email`, `image`, `role` ("admin" | "editor").

### 3.3 Roles
- **admin** — full access to all admin routes, user management, settings, plugins, themes.
- **editor** — can create and edit posts; cannot manage users, change settings, or activate plugins.
- First user created (credentials or OAuth) is automatically assigned `admin`.

### 3.4 Rate limiting
- Login: 5 attempts per email per 15 minutes.
- Login: 20 attempts per IP per 15 minutes.
- Login limiters implemented via in-memory LRU cache (`src/lib/rate-limit.ts`).
- **AI calls:** 50 per user per hour. Enforced server-side via the `ai_usage` DB table (`checkAndIncrementAi()`). Counter resets after 1 hour. Warning tiers in the editor UI: green (0–19), amber (20–29), orange (30–39), red (40–49), blocked at 50.

---

## 4. Content Model

### 4.1 Posts and Pages

The `posts` table stores both blog entries and static pages, differentiated by the `type` column.

| Column | Type | Description |
|---|---|---|
| `id` | integer PK | Auto-incremented |
| `type` | varchar(20) | `"post"` (blog entry) or `"page"` (static page). Default: `"post"` |
| `title` | text | Required |
| `slug` | varchar(255) | Unique. Auto-generated from title if blank |
| `content` | text | Stored as **Markdown** |
| `excerpt` | text | Optional short description |
| `featuredImage` | integer FK → media | Optional |
| `published` | boolean | Derived from `publishedAt` at save time. True if `publishedAt <= now`. |
| `publishedAt` | timestamp | Scheduled or actual publish date/time. Null = unpublished draft. |
| `parentId` | integer FK → posts | Self-reference for hierarchical pages. Null = top-level |
| `aeoMetadata` | jsonb | Structured AI metadata (see §6) |
| `authorId` | integer FK → users | Currently not populated (future: link to adminUsers) |
| `createdAt` / `updatedAt` | timestamp | Auto-managed |

### 4.2 Publish scheduling
- The admin form presents a `datetime-local` picker labelled "Publish Date", defaulting to the current date and time.
- If the selected date/time is in the past or present: `published = true`, `publishedAt = selectedDate`.
- If the selected date/time is in the future: `published = false`, `publishedAt = selectedDate` (scheduled).
- The posts listing shows three status badges: **Published** (green), **Scheduled** with date (amber), **Draft** (grey).
- Scheduled posts do not auto-publish; a future cron-based mechanism is planned for v0.2.

### 4.3 Hierarchical pages
- Pages can have a parent page, forming a tree of unlimited depth.
- The breadcrumb on the public post view renders the parent title and link.
- The parent selector in the admin post editor is hidden when type is "Post" and visible when type is "Page".
- The per-section `llms.txt` endpoint resolves the hierarchy for AI crawlers.

### 4.4 Taxonomy

**Categories** — `categories` table (`id`, `name`, `slug`, `description`, `createdAt`)
**Tags** — `tags` table (`id`, `name`, `slug`, `createdAt`)
**Joins** — `post_categories` and `post_tags` tables with cascade-delete on post deletion.

Both support full CRUD via admin UI and server actions. Slugs are auto-generated from names. Categories and tags can be created inline from the post editor without navigating away.

### 4.5 Media

The `media` table stores file metadata. Actual binaries are managed by the StorageProvider (see §7).

| Column | Description |
|---|---|
| `fileName` | Sanitised filename with timestamp prefix |
| `fileType` | MIME type (validated on upload) |
| `fileSize` | Bytes |
| `url` | Public URL for the file |
| `storageKey` | Provider-specific key used for deletion |
| `altText` | Optional accessibility text |

**Allowed MIME types:** `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/svg+xml`, `video/mp4`, `video/webm`, `video/ogg`
**Maximum file size:** 50 MB

---

## 5. Admin Interface Requirements

### 5.1 Navigation

The admin sidebar uses a two-level hierarchical structure. Sub-items appear only when the user is within the relevant section.

**Top level:**
- Dashboard
- Posts & Pages (sub: Categories, Tags, Media)
- Settings (sub: Users, Plugins, Themes)

**Footer links:** My Profile, ← View Site

Active items and their parent sections are visually highlighted. Sub-items are indented with a left-border indicator.

### 5.2 Posts & Pages

**Listing (`/admin/posts`):**
- Combined view of all posts and pages in a single table.
- **Filter controls:** Type (All / Posts / Pages), Status (All / Published / Scheduled / Draft) — pill toggles, URL-param driven.
- **Sortable columns:** Title (A–Z / Z–A), Date (newest / oldest). Arrow indicators show active sort direction.
- **Columns:** Title, Type badge (blue = Post, purple = Page), AEO score (3-dot indicator: summary · Q&A · entities), Status badge, Date, Actions (Edit, View, Delete).
- Empty filtered state: "No results. Try adjusting the filters."

**New / Edit form (`/admin/posts/new`, `/admin/posts/[id]/edit`):**
- **Type selector** — iOS-style segmented control (Post / Page). Default: Post.
- **Parent Page selector** — hidden when type is Post; visible when type is Page. Excludes the post being edited.
- Title (required), Slug (auto-generated if blank).
- **Content** — Tiptap Markdown editor with Visual / Raw toggle (toolbar: Bold, Italic, Code, H2, H3, Bullet list, Ordered list, Blockquote, Code block).
- **Excerpt** — positioned below the content editor.
- **Categories** — `TaxonomyPicker` component: checkboxes for existing items, inline "New category…" creation field.
- **Tags** — `TaxonomyPicker` component: same pattern as categories.
- **AEO Metadata** — always expanded panel (no toggle). See §6.
- **Publish Date** — `datetime-local` picker, defaults to now. Past/present = publish immediately; future = schedule.
- Submit button: "Create" (new) / "Save Changes" (edit).

### 5.3 Categories and Tags
- Split-panel layout: create form on the left, list with post counts and edit/delete on the right.
- Edit pages for individual items.

### 5.4 Media Library
- Grid view with image preview (or MIME type label for video).
- Upload form (file input + submit).
- Per-item delete button with confirmation dialog, wired to `deleteMedia` which removes both the DB record and the physical file.

### 5.5 Users (admin-only)
- Accessible via Settings → Users.
- List all admin users with role badges.
- Create user (name, email, password, role).
- Edit user (name, email, role).
- Delete user (cannot delete own account).

### 5.6 Profile (any authenticated user)
- Edit own name and email.
- Change own password (requires current password verification).
- Accessible via "My Profile" in the sidebar footer.

### 5.7 Settings
- Edit site name, description, URL via admin UI backed by `updateConfig()`.
- Settings is the parent section for Users, Plugins, and Themes sub-pages.

### 5.8 Plugins (admin-only)
- Accessible via Settings → Plugins.
- Each plugin displayed as a card with: name, version badge, active status badge, description.
- **Active/inactive toggle** — iOS-style switch. Activation takes effect on next page load.
- **Settings button** — independent expand/collapse control (labelled "Settings ▼/▲"). Opens regardless of active/inactive state.
- When settings are open and the plugin is inactive: amber notice explains settings are saved but inactive.
- Settings fields support three input types: `text`, `boolean` (checkbox), `select` (dropdown).
- "Save Settings" button with inline "Saved" confirmation.
- Plugin state and settings stored in `site_config.modules.activePlugins` and `site_config.modules.pluginSettings`.

### 5.9 Themes (admin-only)
- Accessible via Settings → Themes.
- Each theme displayed as a card with: name, version badge, active status badge, description.
- Active theme shows "Currently active" label (no deactivate button — a theme is always active).
- Inactive themes show an "Activate" button. Activation takes effect immediately on the public site.
- Only one theme can be active at a time.

---

## 6. AEO (AI Engine Optimisation) Requirements

Pugmill treats AI engine discoverability as a first-class concern, not an afterthought.

### 6.1 AEO Metadata schema

Each post/page carries an optional `aeoMetadata` JSONB column with the following shape:

```json
{
  "summary": "A one-paragraph description for AI crawlers.",
  "questions": [
    { "q": "What is Pugmill?", "a": "An AI-native CMS built on Next.js." }
  ],
  "entities": [
    { "type": "Organization", "name": "Pugmill", "description": "Open-source CMS" }
  ],
  "keywords": ["cms", "next.js", "ai-native"]
}
```

Field notes:
- `summary` — max 1000 characters.
- `questions` — array of `{ q, a }` pairs. Both fields required for a pair to count toward AEO score.
- `entities` — named entities explicitly discussed in the post. `description` is optional.
- `keywords` — up to 30 strings, max 100 chars each. Used by AI social post generator and keyword extraction tool.

Entity types: `Thing`, `Person`, `Organization`, `Product`, `Place`, `Event`, `SoftwareApplication`, `CreativeWork`.

**AEO completeness score (0–3):** Shown as a 3-dot indicator on the posts list and in the editor. One point each for: summary filled, at least one Q&A pair, at least one entity. Computed by `calcAeoScore()` in `src/lib/aeo.ts`.

### 6.2 llms.txt endpoints

| Route | Purpose |
|---|---|
| `GET /llms.txt` | Site-level index of all top-level published posts and pages |
| `GET /llms-full.txt` | Full content of every published post, including inline Q&A from AEO metadata |
| `GET /[slug]/llms.txt` | Per-section index: resolves slug to a published page and lists its direct children |

All llms.txt responses return `Content-Type: text/plain`. Format follows the [llmstxt.org](https://llmstxt.org) specification.

### 6.3 JSON-LD structured data (core)

Every published post page emits JSON-LD in the page body:
- **`Article` schema** — always present. Includes `headline`, `url`, `datePublished`, `dateModified`, and `description` (from AEO summary if available).
- **`FAQPage` schema** — emitted additionally when the post has one or more AEO Q&A pairs with both question and answer populated.

### 6.4 REST API exposure
All REST API responses include `aeoMetadata` and `parentId` fields. See §8.

---

## 7. Storage Requirements

All file uploads go through the `StorageProvider` interface (`src/lib/storage/types.ts`).

```typescript
interface StorageProvider {
  upload(buffer: Buffer, fileName: string, mimeType: string): Promise<{ url: string; storageKey: string }>;
  delete(storageKey: string): Promise<void>;
}
```

### 7.1 Providers

| `STORAGE_PROVIDER` | Behaviour |
|---|---|
| `local` (default) | Writes to `/public/uploads/`. Suitable for local dev and persistent-volume servers. Not suitable for ephemeral platforms (Vercel). |
| `s3` | Uploads to any S3-compatible store: AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO. |

### 7.2 S3 environment variables

| Variable | Required | Notes |
|---|---|---|
| `S3_BUCKET` | Yes | Bucket name |
| `S3_REGION` | Yes | `us-east-1`, `auto` (R2), etc. |
| `S3_ACCESS_KEY_ID` | Yes | |
| `S3_SECRET_ACCESS_KEY` | Yes | |
| `S3_ENDPOINT` | No | For R2, DO Spaces, MinIO |
| `S3_PUBLIC_URL` | Recommended | CDN or public base URL for served files |

---

## 8. REST API Requirements

Read-only public API. No authentication required. All endpoints return `{ data, meta? }` JSON with CORS headers (`Access-Control-Allow-Origin: *`).

Only **published** content is returned. Write operations remain server-actions only.

| Endpoint | Description |
|---|---|
| `GET /api/posts` | Paginated published posts. Query: `?page=1&limit=10&category=slug&tag=slug` |
| `GET /api/posts/[slug]` | Single post with full content, categories, tags, `aeoMetadata`, `parentId` |
| `GET /api/categories` | All categories with published post counts |
| `GET /api/tags` | All tags with published post counts |
| `GET /api/media` | Paginated media library. Query: `?page=1&limit=20` |

**Performance:** `GET /api/posts` uses exactly 3 DB round-trips regardless of page size (COUNT, paginated SELECT, batch JOIN for categories+tags). No N+1 queries.

---

## 9. SEO Requirements

### 9.1 Per-post metadata
`generateMetadata()` exported from `src/app/(site)/post/[slug]/page.tsx` generates:

- `<title>Post Title | Site Name</title>`
- `<meta name="description">` — excerpt or 160-char plaintext fallback from Markdown content
- `og:title`, `og:description`, `og:url`, `og:type: article`
- `og:image` / `twitter:image` — from `featuredImage` when set
- `twitter:card` — `summary_large_image` (with image) or `summary` (without)
- `publishedTime` and `modifiedTime` for article Open Graph
- `alternates.canonical` URL

### 9.2 Sitemap
`GET /sitemap.xml` — generated by `src/app/sitemap.ts` (Next.js native format).
- Static routes: `/`, `/blog`, `/about`
- All published posts (priority 0.6, `changeFrequency: weekly`)
- All published pages (priority 0.8, `changeFrequency: monthly`)

### 9.3 RSS feed
`GET /feed.xml` — valid RSS 2.0 with `atom:link` self-reference.
- Latest 20 published posts ordered by creation date
- `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`

---

## 10. Security Requirements

See `SECURITY.md` for the full security guide.

| Control | Implementation |
|---|---|
| Authentication | NextAuth JWT; middleware protects `/admin/*` |
| Password hashing | bcryptjs, 12 rounds |
| Input validation | Zod schemas on all server actions |
| HTML sanitisation | rehype-sanitize on Markdown rendering |
| XSS prevention | `dangerouslySetInnerHTML` only used for pre-escaped JSON-LD script tags |
| SQL injection | Drizzle ORM parameterised queries only; no raw string SQL |
| CSRF | Next.js server actions (same-origin + method enforcement) |
| Rate limiting | LRU-cache per email and per IP on login |
| Path traversal | Upload paths validated against allowed directory |
| File upload | MIME type allowlist, extension allowlist, 50 MB cap |
| Security headers | `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` |
| Admin headers | `X-Frame-Options: DENY`, `Cache-Control: no-store` on `/admin/*` |
| Secret scanning | Husky pre-commit hook blocks hardcoded credentials |
| Env validation | `validateEnv()` runs on each request in production; fatal on missing/weak `NEXTAUTH_SECRET` |

---

## 11. Configuration Requirements

CMS configuration is stored in the `site_config` PostgreSQL table as a single JSONB row (`id = 1`).

```typescript
{
  site: {
    name, description, url,
    logo?: string,           // media URL for site logo
    favicon?: string,        // media URL for favicon
    socialLinks?: {          // all optional
      twitter, github, linkedin, facebook, instagram, youtube, tiktok, rss
    },
    seoDefaults?: {
      ogImage?: string,      // fallback OG image URL
      metaDescription?: string,
    },
  },
  appearance: {
    activeTheme: string,
    navigation: [{ label: string, path: string }],
  },
  modules: {
    activePlugins: string[],
    pluginSettings: Record<pluginId, Record<settingKey, string | boolean>>,
  },
  system: { version, headlessMode, maintenanceMode },
}
```

- `getConfig()` — async, DB-backed, in-memory cached with a **60-second TTL**. Falls back to `pugmill.config.json` (seed file only) or built-in defaults if DB is unavailable.
- `updateConfig(newConfig)` — validates with Zod, upserts to DB, invalidates cache immediately.
- `pugmill.config.json` — seed-only. Read once on first boot; not the live config source thereafter.

---

## 12. Plugin System Requirements

### 12.1 Interface

```typescript
interface PluginSettingDef {
  key: string;
  label: string;
  type: "text" | "boolean" | "select";
  default: string | boolean;
  options?: string[];       // for type "select"
  description?: string;
}

interface PugmillPlugin {
  id: string;
  name: string;
  version: string;
  description?: string;
  settingsDefs?: PluginSettingDef[];
  initialize(hooks: HookManager, settings: Record<string, string | boolean>): void | Promise<void>;
  destroy?(): void | Promise<void>;
}
```

### 12.2 Hook system
- **Actions** (`doAction` / `addAction`) — fire-and-forget side effects.
- **Filters** (`applyFilters` / `addFilter`) — transform a value through registered handlers.
- Each hook handler is isolated in try/catch; one failing hook does not break others.
- Plugin `initialize()` receives resolved settings (saved values merged with defaults).

### 12.3 Built-in hooks

| Hook | Type | Fired when |
|---|---|---|
| `post_created` | Action | Post saved for the first time |
| `post_updated` | Action | Post updated |
| `post_deleted` | Action | Post deleted |
| `media_uploaded` | Action | File successfully uploaded |
| `theme_head` | Filter | Theme `<head>` content assembled |
| `theme_head_tags` | Filter | Additional `<head>` tags (used by SEO plugin) |
| `theme_footer` | Action | Theme footer rendered |
| `theme_body_classes` | Filter | Body tag class list |

### 12.4 Bundled plugin: SEO Meta Manager

| Setting | Type | Default | Description |
|---|---|---|---|
| `robotsDirective` | text | `index, follow` | Controls search engine crawl behaviour |
| `emitJsonLd` | boolean | `true` | Emits a `WebSite` JSON-LD schema in the global `<head>` |
| `includeGenerator` | boolean | `true` | Adds `<meta name="generator" content="Pugmill">` |

Injects via `theme_head_tags` filter. Per-post `Article` and `FAQPage` JSON-LD is handled by the core post page (not the plugin) as it requires post-level context.

### 12.5 Distribution model

Plugin discovery uses a static import registry (`src/lib/plugin-registry.ts`) due to Turbopack's lack of dynamic `require()` support. New plugins must be registered manually or via tooling after install.

**Planned installation flow (v1.0 marketplace):**

1. User purchases plugin at Pugmill.com → receives a license key
2. License key added to project `.npmrc` (local dev) or hosting platform env vars (deployed builds): `//registry.pugmill.dev/:_authToken=<key>`
3. `npm install @pugmill-plugins/<name>` — plugin package's `postinstall` script patches `src/lib/plugin-registry.ts` automatically
4. If plugin requires schema changes: `npm run db:migrate`
5. Add any required env vars (API keys, etc.) to `.env.local`
6. Rebuild and redeploy
7. Admin → Plugins → Enable
8. Admin → Plugin Settings → configure

Each marketplace plugin ships two distribution formats: a code package (npm) and an AI agent rebuild prompt. The rebuild prompt references the plugin's hook contract so an AI agent can scaffold the plugin from scratch in a fresh Pugmill install — making plugins resilient to framework upgrades.

**Security note:** Because new plugin code requires a full rebuild before it can execute, there is no runtime code injection attack surface. A compromised admin account cannot install executable code without access to the build pipeline. This is a structural security advantage over interpreted-runtime plugin models (e.g. WordPress PHP plugins).

---

## 13. Theme Requirements

### 13.1 Architecture — three layers

| Layer | Who controls it | Where it lives |
|---|---|---|
| **Global settings** | Site owner, applies to any theme | Admin → Settings, `site_config` DB table |
| **Theme settings** | Site owner, within bounds the theme allows | Admin → Design, `theme_design_configs` DB table |
| **Theme code** | Theme author, requires a rebuild to change | `themes/<id>/` source files |

The admin UI exposes **small edits** — colors, fonts, layout toggles — within the surface area the theme author has explicitly chosen to expose via design tokens. Structural changes require editing theme source files.

### 13.2 Theme file structure

```
themes/<id>/
  manifest.json          — identity and marketplace metadata
  design.ts              — design token contract (required exports)
  Layout.tsx             — root server component wrapping all public pages
  components/
    Header.tsx           — server component (fetches config, passes to client)
    HeaderClient.tsx     — client component (mobile nav, interactivity)
    Footer.tsx           — server component
  views/
    HomeView.tsx         — receives PostSummary[] and HomeLayoutConfig
    PostView.tsx         — receives full post data and ArticleLayoutConfig
    PageView.tsx         — receives page data, breadcrumbs, ArticleLayoutConfig
```

### 13.3 Design token contract

Every theme exports from `themes/<id>/design.ts`:

```ts
DESIGN_TOKEN_DEFS: DesignTokenDef[]   // all token definitions
DESIGN_DEFAULTS: Record<string,string> // default value for each key
SANS_FONTS: string[]                   // curated sans-serif Google Fonts
MONO_FONTS: string[]                   // curated monospace Google Fonts
buildGoogleFontsUrl(config): string | null
buildCssString(config, defs): string   // returns :root { ... } CSS block
```

Token types: `"color"` (color picker), `"google-font"` (select from allowlist), `"select"` (dropdown).

Token groups: `colors`, `typography`, `layout-home`, `layout-post`, `layout-page` (built-in), plus any custom groups rendered under "Theme Options".

Tokens with `editable: false` inject into CSS but are hidden from the admin UI — used for tokens structural to the theme's identity. Tokens with `cssVariable` are injected into `:root { }`. Layout tokens (no `cssVariable`) are passed as props to view components.

### 13.4 CSS variable injection

`Layout.tsx` calls `buildCssString()` on every render and injects the result as a `<style>` tag. Standard variables all themes should define:

`--color-background`, `--color-surface`, `--color-foreground`, `--color-muted`, `--color-border`, `--color-accent`, `--color-accent-fg`, `--color-link`, `--font-sans`, `--font-mono`

### 13.5 Design draft / publish workflow

Design changes follow a draft → publish flow stored in `theme_design_configs`:

| Status | Meaning |
|---|---|
| `draft` | Staged changes, not live. One per theme (enforced by partial unique index). |
| `published` | Live config. One per theme. |
| `archived` | Previous published rows, kept for history. Multiple allowed. |

- **Save draft** — upserts the draft row. Live site unchanged.
- **Preview** — sets `__pugmill_design_preview` cookie. Site renders draft values with an amber banner. Only available when a draft exists.
- **Publish** — atomic transaction: archives current published row, promotes draft to published. Cache invalidated immediately.
- **Discard** — deletes the draft row. No-op (silent) if no draft exists.

The `theme_design_configs` table has a partial unique index on `(theme_id, status) WHERE status IN ('draft', 'published')` — enforcing the one-draft / one-published constraint while allowing unlimited archived rows.

### 13.6 Registry and security

- Active theme set via `config.appearance.activeTheme` in the database.
- Theme name validated against `THEME_ALLOWLIST` in `src/lib/theme-registry.ts` before dynamic import — prevents path traversal attacks.
- New themes must be added to `THEME_ALLOWLIST` and `ALL_THEMES` in the registry file.

### 13.7 Distribution model

Same npm + private registry model as plugins (see §12.5). Themes ship two formats:

1. **npm package** — `@pugmill-themes/<name>`. postinstall script patches `theme-registry.ts`. Rebuild required.
2. **AI agent rebuild prompt** — structured prompt enabling an AI agent to scaffold the theme from scratch in any Pugmill install. Makes themes resilient to framework upgrades — rebuild from prompt rather than patch for major version changes.

**Installation flow:**
1. Purchase at Pugmill.com → license key
2. Add key to `.npmrc` (one-time per project)
3. `npm install @pugmill-themes/<name>` → postinstall patches registry
4. Rebuild and redeploy
5. Admin → Themes → Activate
6. Admin → Design → customize tokens, save draft, preview, publish

---

## 14. Performance Requirements

| Metric | Requirement |
|---|---|
| `/api/posts` query count | Constant 3 round-trips regardless of page size |
| Config cache | In-memory, 60-second TTL. No DB hit on every request |
| DB connection pool | Max 20 connections, 30s idle timeout, 5s connection timeout |
| Media delivery | Served via CDN (S3/R2) in production; local static in dev |
| RSS feed caching | `Cache-Control: public, max-age=3600` |
| Admin routes | `Cache-Control: no-store` — never cached |

---

## 15. Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | Yes | Min 32 chars, non-weak. Generate: `openssl rand -base64 32` |
| `NEXTAUTH_URL` | Yes (prod) | Full public URL of the app, no trailing slash |
| `GITHUB_CLIENT_ID` | No | Enables GitHub OAuth |
| `GITHUB_CLIENT_SECRET` | No | Enables GitHub OAuth |
| `GOOGLE_CLIENT_ID` | No | Enables Google OAuth |
| `GOOGLE_CLIENT_SECRET` | No | Enables Google OAuth |
| `ADMIN_EMAIL` | Setup only | Used by `npm run setup` |
| `ADMIN_PASSWORD` | Setup only | Used by `npm run setup` |
| `ADMIN_NAME` | Setup only | Used by `npm run setup` |
| `STORAGE_PROVIDER` | No | `"local"` (default) or `"s3"` |
| `S3_BUCKET` | If S3 | |
| `S3_REGION` | If S3 | |
| `S3_ACCESS_KEY_ID` | If S3 | |
| `S3_SECRET_ACCESS_KEY` | If S3 | |
| `S3_ENDPOINT` | No | For R2 / DO Spaces / MinIO |
| `S3_PUBLIC_URL` | Recommended if S3 | CDN base URL for public file access |

---

## 16. AI Integration Requirements

Pugmill follows the built-in vs enhanced pattern: every feature works fully without an AI provider. Connecting one in Admin → Settings → AI adds generation, suggestions, and automation additively.

### 16.1 AI provider configuration

AI provider credentials are stored encrypted in the `site_config` DB table (`config.ai`). The encryption key is `AI_ENCRYPTION_KEY` (AES-256-GCM). If unset, the key is stored as plaintext with a server-side warning.

Supported providers: OpenAI (`gpt-4o`, `gpt-4o-mini`), Anthropic (`claude-*`). Configured via Admin → Settings → AI.

### 16.2 AI rate limiter

- **Limit:** 50 AI API calls per user per hour.
- **Storage:** `ai_usage` table — one row per user (`user_id` PK, `window_start` timestamp, `count` integer). Window resets after 1 hour; the counter is atomically incremented with a raw SQL upsert that resets when the window expires.
- **Enforcement:** `checkAndIncrementAi(userId)` in `src/lib/rate-limit.ts` — called server-side at the top of every AI API route before the provider call. Returns `{ allowed, count, limit }`.
- **Read-only check:** `getAiUsage(userId)` — returns current count without incrementing.
- **Client meter:** PostForm shows a colour-coded usage bar (green 0–19, amber 20–29, orange 30–39, red 40–49, blocked at 50). Updated from `usage` field returned in every AI response body.

### 16.3 AI tools in the post editor

All tools call `/api/ai/suggest` or `/api/ai/refine`. Both routes enforce the rate limiter and return `{ result, usage }` on success or `{ error, usage }` on failure (including 429 for rate limit exceeded).

| Tool | Route | Description |
|---|---|---|
| Generate All AEO Metadata | `/api/ai/suggest` | Fills excerpt, slug, categories, tags, AEO, and keywords in one shot |
| Suggest Titles | `/api/ai/suggest?type=titles` | 5 alternative titles |
| Generate Excerpt | `/api/ai/suggest?type=excerpt` | 1–2 sentence excerpt |
| Generate Slug | `/api/ai/suggest?type=slug` | SEO-friendly URL slug from title |
| Generate AEO | `/api/ai/suggest?type=aeo` | Summary, Q&A pairs, entities |
| Extract Keywords | `/api/ai/suggest?type=keywords` | 5–15 SEO keywords |
| Suggest Categories | `/api/ai/suggest?type=categories` | 1–3 category suggestions |
| Suggest Tags | `/api/ai/suggest?type=tags` | 3–7 tag suggestions (prefers existing tags) |
| Write | `/api/ai/refine` (mode=write) | Full draft from prompt/outline |
| Refine | `/api/ai/refine` (mode=refine) | Editor pass on existing content |
| Tone Check | `/api/ai/suggest?type=tone-check` | Passages deviating from author voice guide |
| Topic Focus Report | `/api/ai/suggest?type=topic-report` | Focus score 1–5, note |
| Refine Focus | `/api/ai/suggest?type=refine-focus` | Up to 4 focus issues with quotes and recommendations; shown when topic score < 5 |
| Reading Level | `/api/ai/suggest?type=reading-level` | Grade level + voice fit |
| Meta Title Variants | `/api/ai/suggest?type=meta-title` | 3 SEO meta title options |
| Headline Variants | `/api/ai/suggest?type=headline-variants` | Curiosity + utility headline pair |
| Internal Links | `/api/ai/suggest?type=internal-links` | 3–5 internal link opportunities |
| Content Brief | `/api/ai/suggest?type=brief` | Full content brief with outline, angle, audience |
| Social Post | `/api/ai/suggest?type=social-post` | Platform-specific post draft (LinkedIn/X/Facebook/Substack); uses AEO metadata as primary input |
| Site Summary | `/api/ai/suggest?type=site-summary` | AEO site summary for llms.txt |
| Site FAQs | `/api/ai/suggest?type=site-faqs` | 4–6 site-level FAQ pairs for llms.txt |

### 16.4 Social post generator

Platform buttons appear in the editor's AI Analysis section. Clicking a platform fires immediately, replaces any previous draft for that platform. Each platform has a character limit enforced client-side (counter turns red when over):

| Platform | Limit |
|---|---|
| LinkedIn | 3000 |
| X | 280 |
| Facebook | 500 |
| Substack | 800 |

The API route uses AEO metadata (summary, Q&A, keywords) as primary input when available, falling back to raw content. This produces smarter drafts when "Generate All AEO Metadata" has been run.

### 16.5 Author voice

Each admin user has an `authorVoice` text field (Admin → My Profile). This free-text style guide is injected into the system prompt for tone-sensitive tools (Write, Refine, Tone Check, Reading Level, Social Post).

---

## 17. First-Run Setup

```bash
cp .env.example .env.local      # fill in DATABASE_URL and NEXTAUTH_SECRET at minimum
npm install
npm run db:push                 # create all database tables (fresh install)
npm run setup                   # create the first admin account + seed config
npm run dev                     # start development server at http://localhost:3000
```

For **existing deployments** after pulling new changes:
```bash
npm run db:migrate              # run incremental migration scripts (safe to re-run)
```

Visit `/admin/login` to sign in.

---

## 18. Known Limitations (v0.1)

| # | Limitation | Planned resolution |
|---|---|---|
| L1 | Plugin and theme registry requires manual static imports (Turbopack limitation) | Registry CLI + dynamic discovery in v0.2 |
| L2 | No post author display on frontend (`authorId` unpopulated) | Link `authorId` to `adminUsers` in v0.2 |
| L3 | Legacy `users` table with unused `replitId` column (Replit Auth remnant) | Schema cleanup in v0.2 |
| L4 | Config cache TTL only; no real-time cross-instance invalidation | Redis pub/sub for v1.0 managed tier |
| L5 | Audit log is console-only (stdout JSON) | DB-backed `audit_logs` table in v0.2 |
| L6 | Scheduled posts do not auto-publish (cron not implemented) | Cron-based publish worker in v0.2 |
| L7 | No post draft preview (design draft preview is implemented; post-level preview is not) | Deferred to v0.2 |
| L8 | No bulk post operations | Deferred to v0.2 |
| L9 | No Content Security Policy header | Complex due to Tailwind inline styles; v0.2 |
| L10 | AI rate limiter uses `TIMESTAMP WITHOUT TIME ZONE` — comparisons assume consistent server timezone | Use `TIMESTAMPTZ` in v0.2 |
