# ReplPress: Implementation Guide

This guide contains the exact prompts and sequence required to build ReplPress using the Replit Agent. 

## Pre-Requisites
1. Open the **PostgreSQL** tool in the Replit sidebar and click "Attach Database."
2. Ensure `AGENT.md`, `package.json`, and `replpress.config.json` are in the root directory.

---

## Sprint 1: The Core Engine
**Goal:** Initialize the environment, database, and the Hook system.

**Prompt to give the Agent:**
> "Read `AGENT.md` and `package.json`. First, install the dependencies. Then, create the Drizzle schema in `src/lib/db/schema.ts` with tables for 'posts' (id, title, content, slug, authorId, createdAt) and 'settings' (key, value). Finally, implement the `HookManager` in `src/lib/hooks.ts` as described in our architecture."

---

## Sprint 2: The Theme System
**Goal:** Create the dynamic loader that allows ReplPress to swap looks.

**Prompt to give the Agent:**
> "Create a 'Default' theme in `/themes/default` with a basic Layout, Header, and Footer using Tailwind CSS. Then, create `src/lib/theme-loader.tsx`. This utility should read `activeTheme` from `replpress.config.json` and dynamically import the correct theme components. Update the main `src/app/layout.tsx` to use this loader."

---

## Sprint 3: The Admin Dashboard (CRUD)
**Goal:** Build the interface to manage content.

**Prompt to give the Agent:**
> "Build a modern Admin Dashboard at `/admin`. It must use Replit Auth to verify the user. Use shadcn/ui components to create a 'Posts' management table (Create, Read, Update, Delete). Ensure the 'New Post' editor allows for Markdown input and saves directly to the PostgreSQL database via a Server Action."

---

## Sprint 4: The Plugin System
**Goal:** Enable modularity without touching core code.

**Prompt to give the Agent:**
> "Create a plugin loader that scans the `/plugins` directory on startup. Create a sample plugin called 'hello-world' that uses a hook to append '' to the HTML head. Add a 'Plugins' page to the Admin Dashboard that lets me toggle plugins on and off by updating `replpress.config.json`."

---

## Maintenance & Rebuilding
If the project structure feels messy or a feature breaks:
1. Ask the Agent: "Verify my project structure against `AGENT.md`. Are there any files out of place?"
2. To reset the DB: "Run the `db:push` script to ensure the Postgres schema matches my Drizzle files."
