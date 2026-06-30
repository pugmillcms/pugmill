"use client";
import { useEffect, useState, useCallback } from "react";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";

interface Props {
  plugins?: { id: string; name: string; actionHref?: string }[];
}

const NAV_ITEMS = [
  { label: "Dashboard", path: "/admin", group: "Navigate" },
  { label: "Posts & Pages", path: "/admin/posts", group: "Navigate" },
  { label: "New Post", path: "/admin/posts/new", group: "Navigate" },
  { label: "Categories", path: "/admin/categories", group: "Navigate" },
  { label: "Tags", path: "/admin/tags", group: "Navigate" },
  { label: "Media", path: "/admin/media", group: "Navigate" },
  { label: "Design — Customize", path: "/admin/design", group: "Navigate" },
  { label: "Themes", path: "/admin/themes", group: "Navigate" },
  { label: "Plugins", path: "/admin/plugins", group: "Navigate" },
  { label: "Settings — Site Identity", path: "/admin/settings", group: "Navigate" },
  { label: "Settings — Reading", path: "/admin/settings/reading", group: "Navigate" },
  { label: "Settings — Navigation", path: "/admin/settings/navigation", group: "Navigate" },
  { label: "Settings — SEO", path: "/admin/settings/seo", group: "Navigate" },
  { label: "Settings — AI", path: "/admin/settings/ai", group: "Navigate" },
  { label: "Settings — Network", path: "/admin/settings/network", group: "Navigate" },
  { label: "Users", path: "/admin/users", group: "Navigate" },
  { label: "Notifications", path: "/admin/notifications", group: "Navigate" },
  { label: "View Site", path: "/", group: "Navigate" },
];

export default function CommandPalette({ plugins = [] }: Props) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const toggle = useCallback(() => setOpen(o => !o), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        toggle();
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  function navigate(path: string) {
    setOpen(false);
    if (path === "/") {
      window.open("/", "_blank");
    } else {
      router.push(path);
    }
  }

  const pluginItems = plugins.map(p => ({
    label: p.name,
    path: p.actionHref ?? `/admin/plugins/${p.id}`,
    group: "Plugins",
  }));

  const allItems = [...NAV_ITEMS, ...pluginItems];

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh] px-4"
      onClick={() => setOpen(false)}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-lg bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <Command className="[&_[cmdk-input-wrapper]]:border-b [&_[cmdk-input-wrapper]]:border-zinc-200 dark:[&_[cmdk-input-wrapper]]:border-zinc-700">
          <div className="flex items-center px-4 gap-2" cmdk-input-wrapper="">
            <svg className="w-4 h-4 text-zinc-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <Command.Input
              autoFocus
              placeholder="Search or jump to…"
              className="w-full py-3.5 text-sm bg-transparent outline-none placeholder:text-zinc-400 text-zinc-900 dark:text-zinc-100"
            />
            <kbd className="hidden sm:inline-flex items-center gap-0.5 text-zinc-300 text-xs font-mono">
              <span>esc</span>
            </kbd>
          </div>

          <Command.List className="max-h-72 overflow-y-auto p-2">
            <Command.Empty className="py-8 text-center text-sm text-zinc-400">
              No results found.
            </Command.Empty>

            {["Navigate", "Plugins"].map(group => {
              const items = allItems.filter(i => i.group === group);
              if (items.length === 0) return null;
              return (
                <Command.Group
                  key={group}
                  heading={group}
                  className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-zinc-400"
                >
                  {items.map(item => (
                    <Command.Item
                      key={item.path}
                      value={item.label}
                      onSelect={() => navigate(item.path)}
                      className="flex items-center gap-3 px-2 py-2 rounded-md text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer aria-selected:bg-zinc-100 dark:aria-selected:bg-zinc-800 aria-selected:text-zinc-900 dark:aria-selected:text-zinc-100 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5 text-zinc-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      {item.label}
                    </Command.Item>
                  ))}
                </Command.Group>
              );
            })}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
