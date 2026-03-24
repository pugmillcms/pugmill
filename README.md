# Pugmill CMS

**A rebuildable, AI-native CMS designed for the human-AI team.**

Pugmill CMS is a modern, modular Content Management System built for the 2026 developer ecosystem — where every admin works alongside an AI agent. It ships with a full admin dashboard, a Markdown-first editor, hierarchical content types, a REST API for headless consumption, and first-class **AI Engine Optimisation (AEO)** — including `llms.txt` endpoints that make your content natively discoverable by large language models.

> **v0.1 Developer Preview.** Built for technically capable humans working with AI agents in Claude Code, Cursor, Replit, or similar environments.

---

## Philosophy

Pugmill CMS is designed around a single belief: the future of content management is a human-AI team, not a solo human operator.

The human is in charge — they set direction, make decisions, own outcomes. The AI agent brings context, technical judgment, and execution. Pugmill CMS is built to serve both halves of that team.

This shapes what belongs in the product. A CMS built for solo operators needs to anticipate every use case and bundle a feature for each one. A CMS built for the human-AI team can stay lean, because the agent can handle anything the product doesn't cover — on demand, tailored to the situation, without adding permanent complexity to the codebase.

**The scope filter:** If an AI agent can do something trivially as a one-off task, it does not belong in core. Core exists for things that run continuously, require deep integration, or establish trust boundaries. Everything else is either a plugin (persistent, optional, needed by many) or agent-generated (one-time, specific, written on demand).

**The built-in vs enhanced pattern:** Every feature in Pugmill CMS works fully without an AI provider. Connect one in Settings → AI and the same features become meaningfully smarter — AEO auto-generation, content suggestions, alt text, and more. The built-in layer is not a crippled preview. Both levels are complete. AI adds speed and intelligence, not basic functionality.

Read [`PHILOSOPHY.md`](./PHILOSOPHY.md) before building on or extending Pugmill CMS. It is the most important document in this repository.

---

## Why Pugmill CMS?

| Capability | Description |
|---|---|
| **Human-AI Native** | Docs written as active briefings for AI agents — every admin's agent is a well-briefed advisor, not a blank slate |
| **AEO-Native** | Per-post AEO metadata (summaries, Q&A pairs, entities) served via `llms.txt` spec endpoints |
| **Headless-Ready** | Full REST API (`/api/posts`, `/api/categories`, `/api/tags`, `/api/media`) with CORS, pagination, and `{ data, meta }` envelopes |
| **Markdown-First** | Tiptap editor with Visual ↔ Raw Markdown toggle; no HTML soup |
| **Hierarchical Content** | Pages nest under parent pages; breadcrumb nav generated automatically |
| **Plugin System** | Plugins register lifecycle hooks (`content:render`, `post:save`, `admin:sidebar`, etc.) via `HookManager` |
| **Theme System** | Full design token system with draft/publish workflow. Colors, fonts, and layout controls editable in Admin → Design without touching code |
| **Storage Abstraction** | `LocalStorageProvider` (default) or `S3StorageProvider` (AWS S3, R2, DO Spaces, MinIO) |
| **SEO & Discovery** | `generateMetadata()`, `sitemap.ts`, `/feed.xml` (RSS 2.0), Open Graph, Twitter Cards |
| **Built-in vs Enhanced** | Every feature works without AI. Connect an AI provider (Admin → Settings → AI) and the same features gain generation, suggestion, and automation — AEO auto-draft, content refine, tone check, topic focus, social post generator, and more. Per-user hourly rate limit (50 calls/hr) enforced server-side with a colour-coded usage meter in the editor |
| **Content Revisions** | Every post save creates a revision snapshot; restore any previous version from the edit page |
| **Lean Core** | Small enough for an agent to understand completely in one context window; opinionated enough that the right path is obvious |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Server Components, Server Actions) |
| Language | TypeScript 5 |
| Database | PostgreSQL 16 |
| ORM | Drizzle ORM 0.38 |
| Auth | NextAuth v5 (Credentials + GitHub OAuth + Google OAuth) |
| Styling | Tailwind CSS 3 |
| Editor | Tiptap 3 + tiptap-markdown |
| Storage | Local filesystem / AWS S3 (pluggable) |
| Markdown rendering | react-markdown + remark-gfm + rehype-sanitize |

---

## Quick Start

### Prerequisites

- Node.js 22+
- PostgreSQL 16 database
- (Optional) AWS S3-compatible bucket for media storage

### 1. Clone & install

```bash
git clone https://github.com/pugmillcms/pugmill.git
cd pugmill
npm install
```

### 2. Configure environment

Copy the example env file and fill in your values:

```bash
cp .env.example .env.local
```

Required variables:

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/pugmill

# NextAuth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret-here

# Admin seed (first-run setup)
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=your-admin-password
```

Optional variables (OAuth, S3, etc.) are documented in [REQUIREMENTS.md](./REQUIREMENTS.md#environment-variables).

### 3. Push the database schema

```bash
npm run db:push        # fresh install — creates all tables
# OR for existing deployments:
npm run db:migrate     # incremental migrations (safe to re-run)
```

### 4. Seed the admin user

```bash
npm run setup
```

### 5. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000/admin](http://localhost:3000/admin) and sign in with your admin credentials.

---

## Project Structure

```
pugmill/
├── src/
│   ├── app/
│   │   ├── (site)/               # Public-facing routes
│   │   │   ├── blog/             # Paginated blog listing
│   │   │   └── post/[slug]/      # Individual post pages
│   │   ├── admin/                # Admin dashboard
│   │   │   ├── posts/            # Post CRUD
│   │   │   ├── pages/            # Page CRUD
│   │   │   ├── categories/       # Category management
│   │   │   ├── tags/             # Tag management
│   │   │   ├── media/            # Media library
│   │   │   ├── users/            # User management
│   │   │   ├── design/           # Design token editor (draft/publish)
│   │   │   ├── themes/           # Theme switcher
│   │   │   └── settings/         # Site configuration
│   │   ├── api/                  # REST API (headless)
│   │   │   ├── posts/
│   │   │   ├── categories/
│   │   │   ├── tags/
│   │   │   └── media/
│   │   ├── [slug]/llms.txt/      # Per-section llms.txt
│   │   ├── llms.txt/             # Site-level llms.txt
│   │   ├── llms-full.txt/        # Full-content llms.txt
│   │   ├── sitemap.ts            # XML sitemap (native Next.js)
│   │   └── feed.xml/             # RSS 2.0 feed
│   ├── components/
│   │   └── editor/
│   │       ├── MarkdownEditor.tsx    # Tiptap Visual/Raw toggle
│   │       └── AeoMetadataEditor.tsx # AEO Q&A + entity builder
│   ├── lib/
│   │   ├── db/                   # Drizzle schema + client
│   │   ├── actions/              # Server Actions (posts, media, users…)
│   │   ├── storage/              # Storage abstraction (Local + S3)
│   │   ├── auth.ts               # NextAuth configuration
│   │   ├── config.ts             # DB-backed site config (60s TTL cache)
│   │   └── hooks/                # HookManager
│   └── types/
│       └── next-auth.d.ts        # Module augmentation for typed session
├── plugins/                      # Drop-in plugin packages
│   ├── comments/
│   ├── contact-form/
│   └── cookie-consent/
├── themes/                       # Visual theme packages
│   ├── default/                  # Built-in default theme
│   └── _template/                # Starter template for new themes
├── scripts/
│   ├── setup.ts                  # First-run admin seed
│   ├── migrate-001-design-config-upsert.ts  # DB migration (existing installs)
│   └── env-check.ts              # Env var validation
├── pugmill.config.json        # Active theme + enabled plugins
├── AGENT.md                      # AI agent instructions
├── GUIDE.md                      # Sprint-by-sprint build guide
├── REQUIREMENTS.md               # Full requirements document
└── SECURITY.md                   # Security policy
```

---

## Content Model

### Post types

| Type | Description |
|---|---|
| `post` | Dated blog entry; appears in `/blog` and `/feed.xml` |
| `page` | Evergreen page; can nest under a parent page |

### AEO Metadata

Every post/page can carry structured AEO metadata (stored as JSONB):

```json
{
  "summary": "One-paragraph plain-English summary for LLMs",
  "questions": [
    { "q": "What is Pugmill?", "a": "A headless CMS…" }
  ],
  "entities": [
    { "type": "SoftwareApplication", "name": "Next.js", "description": "React framework" }
  ],
  "keywords": ["cms", "next.js", "ai-native"]
}
```

This data is surfaced in `/llms.txt`, `/llms-full.txt`, and `/{slug}/llms.txt`.

---

## REST API

All endpoints return `{ data, meta }` with CORS headers. Responses are not authenticated (public read-only).

| Endpoint | Description |
|---|---|
| `GET /api/posts` | Paginated posts; supports `?page=`, `?limit=`, `?published=` |
| `GET /api/posts/[slug]` | Single post by slug, with AEO metadata |
| `GET /api/categories` | All categories |
| `GET /api/tags` | All tags |
| `GET /api/media` | All media records |

Example:

```bash
curl https://your-site.com/api/posts?limit=5&page=1
```

```json
{
  "data": [
    {
      "id": 1,
      "slug": "hello-world",
      "title": "Hello World",
      "excerpt": "My first post",
      "type": "post",
      "parentId": null,
      "categories": [{ "id": 1, "name": "General", "slug": "general" }],
      "tags": [],
      "createdAt": "2026-03-01T00:00:00.000Z",
      "updatedAt": "2026-03-01T00:00:00.000Z"
    }
  ],
  "meta": { "total": 42, "page": 1, "limit": 5, "totalPages": 9 }
}
```

---

## AEO & llms.txt

Pugmill implements the [llms.txt specification](https://llmstxt.org/):

| Route | Content |
|---|---|
| `/llms.txt` | Site overview + index of all published content |
| `/llms-full.txt` | Full content of every post, including AEO Q&A |
| `/{slug}/llms.txt` | Section-level index for a parent page and its children |

---

## Storage

Set `STORAGE_PROVIDER` in your `.env.local`:

| Value | Behaviour |
|---|---|
| `local` (default) | Files saved to `public/uploads/` on the server filesystem |
| `s3` | Files uploaded to an S3-compatible bucket |

S3 additional variables:

```env
STORAGE_PROVIDER=s3
S3_BUCKET=my-bucket
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_ENDPOINT=          # Optional: Cloudflare R2, DO Spaces, MinIO
S3_PUBLIC_URL=        # Optional: CDN URL prefix
```

---

## Plugin Development

Plugins live in `/plugins/<name>/` and must export a `PugmillPlugin` object:

```typescript
// plugins/my-plugin/index.ts
import type { PugmillPlugin } from "@/lib/plugin-registry";

const plugin: PugmillPlugin = {
  id: "my-plugin",
  name: "My Plugin",
  version: "1.0.0",
  description: "Does something useful.",
  async initialize(hooks, settings) {
    hooks.addAction("post:after-save", async ({ post }) => {
      // react to a new post being saved
    });
    hooks.addFilter("content:render", ({ input, post }) => {
      return input + "\n\n*Custom footer appended by my-plugin.*";
    });
  },
};

export default plugin;
```

Enable and configure via Admin → Settings → Plugins. See [`HOOKS.md`](./HOOKS.md) for all available hooks.

---

## Theme Development

Themes live in `/themes/<name>/` and must export a `Layout.tsx`, page-level views (`HomeView`, `PostView`, `PageView`), and a `design.ts` contract. Activate via Admin → Themes.

### Design token contract

Each theme defines its editable surface in `design.ts`:

```ts
// themes/my-theme/design.ts
export const DESIGN_TOKEN_DEFS: DesignTokenDef[] = [
  {
    key: "colorAccent",
    label: "Accent",
    type: "color",
    group: "colors",
    cssVariable: "--color-accent",
    default: "#2563eb",
    editable: true,
  },
  // ... more tokens
];
```

Token types: `"color"` (color picker), `"google-font"` (font selector), `"select"` (dropdown). Tokens with `editable: false` inject into CSS but are hidden from the admin UI. Design changes save as a draft and go live only when published — the live site is unaffected until then.

See [`THEMES.md`](./THEMES.md) for the full contract and [`/themes/_template/`](./themes/_template/) as your starting point.

---

## Security

- Pre-commit hook scans staged files for hardcoded secrets, `.env` files, private keys, AWS keys, and connection strings
- All admin routes require an authenticated session with `admin` or `editor` role
- Media uploads are path-traversal guarded; only `image/*` and common doc MIME types accepted
- HTML rendering uses `rehype-sanitize` — raw HTML in Markdown is sanitized before display
- See [SECURITY.md](./SECURITY.md) for the full vulnerability disclosure policy

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run setup` | Seed admin user (first run) |
| `npm run db:push` | Push Drizzle schema to database (fresh installs — creates all tables) |
| `npm run db:migrate` | Run incremental migration scripts in order (existing installs after schema updates; safe to re-run) |
| `npm run db:studio` | Open Drizzle Studio (visual DB browser) |
| `npm run env:check` | Validate required environment variables |

---

## License

MIT — see [LICENSE](./LICENSE).
