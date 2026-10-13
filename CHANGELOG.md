# Changelog

All notable changes to Pugmill CMS are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Fixed

- **Editor: Markdown tables are no longer destroyed by a Visual-mode save.** The Tiptap schema had no table node, so a table loaded into Visual mode was flattened into run-together text and saved that way. Visual mode now includes `@tiptap/extension-table`; simple tables (header row, one paragraph per cell) round-trip to pipe syntax through `tiptap-markdown`.
- **AI Internal Links: correct addresses, pages included, existing links left alone.** The tool indexed posts only, showed the model a `/post/<slug>` path and then prefixed `/post/` again on insert, producing `/post/post/<slug>` (404). The suggest route now indexes published pages and posts, validates each suggestion against that index and returns a server-resolved `path` (`/<slug>` for pages, `/post/<slug>` for posts). Inserting a suggestion is refused when the anchor overlaps an existing Markdown link or sits on a heading or table row.

---

## [0.1.0] — 2026-05-02 — Developer Preview

First public release. Intended for developers working with AI agents in Claude Code, Cursor, Replit, or similar environments. Public APIs may shift before 1.0.

### Core CMS

- Full-stack CMS: posts, pages, categories, tags, hierarchical pages (parent/child), media library with drag-and-drop upload.
- Markdown-first Tiptap editor (Visual / Raw Markdown toggle, sticky toolbar, formatting shortcuts, image insert with AI alt text).
- Content revisions: every save creates a snapshot; any previous version is restorable from the edit page.
- Bulk AEO page (`/admin/posts/bulk-aeo`) — sequential AI generation across all published posts with configurable batch size and rate-limit-bypassing route.
- AI integration (Anthropic, OpenAI, Gemini): Generate All sequential agent, Rewrite with instructions, Tone Check, Reading Level, Topic Focus, Internal Links, Social Post, Intent Classification.
- AEO metadata per post (summary, Q&A pairs, entities, keywords) served via `/llms.txt`, `/llms-full.txt`, and `/{slug}/llms.txt` for hierarchical sections.
- JSON-LD structured data (`Article`, `FAQPage`) on every published post page.
- Per-post SEO fields: `seo_title`, `seo_meta_description`, `robots_noindex`, `robots_nofollow`, `canonical_url`, `og_image_url`.
- RSS 2.0 feed (`/feed.xml`) with `atom:link` self-reference.
- Read-only public REST API (`/api/posts`, `/api/categories`, `/api/tags`, `/api/media`) — CORS-enabled, paginated `{ data, meta }` envelope, N+1-free.
- Admin dashboard with Getting Started onboarding checklist, monthly activity charts, Bot Analytics teasers.
- NextAuth v5 authentication: Credentials, GitHub OAuth, Google OAuth; JWT sessions; `admin`/`editor` roles.
- Storage abstraction: `LocalStorageProvider` (default) and `S3StorageProvider` (AWS S3, R2, DO Spaces, MinIO).
- Local-draft autosave for new posts (3s debounce localStorage with restore banner).

### Plugin & Theme System

- `HookManager` with typed actions and filters; `ActionCatalogue` / `FilterCatalogue` as the contract.
- Drop-in plugin packages in `/plugins/` registered through `pugmill.config.json`.
- Bundled plugins: `default-widgets` (TOC, Recent Posts, Related Posts, Categories, Sibling Pages, Sub-pages, FAQ), `bot-analytics`, `contact-form`, `cookie-consent`.
- FAQ widget with three display styles: Plain, Accordion (native `<details>`, no JS), Numbered.
- Visual theme packages in `/themes/` with design token contract, draft/publish workflow, color presets, Google Fonts picker.
- Three bundled themes: `default`, `editorial` (long-form journalism, Playfair Display), `mono` (terminal-inspired, JetBrains Mono).
- Homepage section builder — five section types (`hero`, `post-feed`, `featured-post`, `text-block`, `cta`) with reorderable stacks; section rendering delegated to per-theme `Sections.tsx`.
- Theme-declared header layout presets (`HEADER_LAYOUTS`, `HEADER_MODIFIERS`).

### Bot Analytics & Network

- Bot Analytics plugin: `plugin_bot_analytics_daily` (90-day retention) and `plugin_bot_analytics_recent` (ring buffer); admin page with visit totals, resource breakdown, and AI-generated traffic insights.
- AEO endpoint bot tracking — `llms.txt`, `llms-full.txt`, `sitemap.xml`, `robots.txt`, `feed.xml` route handlers fire `request:bot-visit`.
- 13+ classified bots: GPTBot, ChatGPT-User, OAI-SearchBot, Claude, Claude-User, Perplexity, Perplexity-User, Gemini, Amazonbot, Meta, Cohere, CCBot, Googlebot, Bingbot, DuckDuckBot, Bytespider, Applebot.
- Daily network reporting cron (`/api/cron/report-network`) sends opted-in bot visit data to the AEO Intelligence Network at aeopugmill.com.

### Security & Infrastructure

- bcryptjs (12 rounds), rehype-sanitize on all rendered HTML, Zod validation on every Server Action input.
- Rate limiting on login, AI endpoints, and public ingest.
- Security headers, Husky secret-scanning pre-commit hook.
- Drizzle ORM + PostgreSQL 16 with idempotent migration runner (`schema_migrations` table; alphabetical scan).
- Replit-ready: `replit-init.ts` first-run wizard with sentinel pattern, auto-generated secrets, domain detection.
- Auth guard at `src/proxy.ts` (Next.js 16 convention).

### Documentation

- `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `PHILOSOPHY.md`.
- Authoring guides: `PLUGIN_AUTHORING.md`, `PLUGIN_STANDARD.md`, `THEME_AUTHORING.md`, `THEMES.md`, `RECIPE_AUTHORING.md`.
- Reference: `HOOKS.md`, `AGENT.md`, `CLAUDE.md`, `REQUIREMENTS.md`.
