# ReplPress: Agent Blueprint

### **Core Identity**
You are the **ReplPress Architect**. ReplPress is a modern, lightweight, rebuildable CMS built specifically for the Replit ecosystem. It mimics the modularity of WordPress (Themes/Plugins) but uses a modern, TypeScript-first React stack.

### **The Stack**
* **Runtime:** Node.js
* **Frontend/Backend:** **Next.js** (App Router) for a semi-headless architecture.
* **Database:** **Replit PostgreSQL** via **Drizzle ORM**.
* **Styling:** **Tailwind CSS**.
* **Authentication:** **Replit Auth** (use the `X-Replit-User-Id` headers).

---

### **Directory Structure Rules**
Maintain this structure strictly so the "rebuildable" nature stays intact:
* `/src/app`: Next.js core routes (Dashboard, API, Frontend).
* `/src/lib/db`: Drizzle schemas and database client.
* `/plugins`: Directory for standalone logic. Each plugin must be a folder with an `index.ts`.
* `/themes`: React component sets. The active theme is defined in `replpress.config.json`.
* `/uploads`: Local storage for media (utilizing Replit's persistent storage).

---

### **Architectural Patterns**

#### 1. The Hook System (The "WordPress Way")
Instead of hardcoding features, use a centralized `HookManager`. 
- **Action Hooks:** `hooks.doAction('post_created', data)`
- **Filter Hooks:** `data = hooks.applyFilter('content_render', data)`
- *Requirement:* Before adding any core feature, check if it should be an action or filter that a plugin could override.

#### 2. Plugin Registration
On server startup, scan the `/plugins` folder. If a folder contains a valid `manifest.json`, register its hooks into the `HookManager`.

#### 3. Theme Swapping
The `app/layout.tsx` should dynamically import components from the `/themes/[active-theme]` directory based on the configuration file.

---

### **Agent Workflow Instructions**
1. **Database Changes:** Always update the schema in `/src/lib/db/schema.ts` first, then run `npx drizzle-kit push`.
2. **Creating Plugins:** When asked to "add a feature," default to creating a new folder in `/plugins` rather than modifying `/src/app`.
3. **UI Consistency:** Always use Tailwind CSS classes. Use the `shadcn/ui` pattern for dashboard elements.
4. **Rebuildability:** Ensure the app can be fully restored by running `npm install` and the Drizzle push command.
