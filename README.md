# ReplPress
**The Rebuildable, AI-Native CMS for Replit.**

ReplPress is a modern, modular Content Management System (CMS) designed from the ground up to be built, maintained, and extended by the **Replit Agent**. It brings the extensibility similar to other open source CMS platforms (Themes & Plugins) to the modern TypeScript/React stack.

## Why ReplPress?
Unlike some solutions **ReplPress** is built for the 2026 developer ecosystem:
- **Agent-First:** Structured specifically so AI agents can add features without breaking core logic.
- **Zero-Config Hosting:** Runs natively on Replit with PostgreSQL and Replit Auth.
- **Modern Stack:** Next.js (App Router), Drizzle ORM, and Tailwind CSS.
- **Modular:** Swap themes and toggle plugins via a simple JSON configuration.

---

## The Stack
- **Framework:** [Next.js 15+](https://nextjs.org/)
- **Database:** [Replit PostgreSQL](https://replit.com/usage/postgresql)
- **ORM:** [Drizzle ORM](https://orm.drizzle.team/)
- **Styling:** [Tailwind CSS](https://tailwindcss.com/)
- **Auth:** [Replit Auth](https://docs.replit.com/programming-ide/auth/overview)

---

## Project Structure
ReplPress follows a strict modular architecture to ensure "rebuildability":
- `/src/app`: Core application routes and Admin Dashboard.
- `/src/lib`: Core utilities (Database, Hook System, Auth).
- `/plugins`: Standalone features (e.g., SEO, Analytics, Custom Blocks).
- `/themes`: Visual component sets (e.g., Default, DarkMode, Portfolio).
- `replpress.config.json`: The "Source of Truth" for site state.

---

## Getting Started (for Replit Agent)
To begin building ReplPress, follow these steps:
1. **Initialize:** "Read `AGENT.md` and `GUIDE.md` to understand the architecture."
2. **Setup:** "Install dependencies and push the Drizzle schema to PostgreSQL."
3. **Build:** "Follow the Sprints outlined in `GUIDE.md` sequentially."

---

## Developing Plugins
Every plugin lives in its own folder within `/plugins` and must contain:
1. `manifest.json`: Metadata for the Admin UI.
2. `index.ts`: Logic that registers with the `HookManager`.

## Creating Themes
Themes are found in `/themes`. A theme consists of a `Layout.tsx` and specific "Views" (Home, Post, Page) that the core app dynamically imports.

---

## License
Open Source under the MIT License. Built for the Replit Community.
