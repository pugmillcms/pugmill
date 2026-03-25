"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  plugins?: { id: string; name: string; actionHref?: string }[];
  badges?: Record<string, number>;
}

const topNavItems = [
  { label: "Dashboard", path: "/admin", exact: true },
  { label: "Notifications", path: "/admin/notifications" },
  { label: "Content", path: "/admin/posts" },
  { label: "Design", path: "/admin/design" },
  { label: "Plugins", path: "/admin/plugins" },
  { label: "Settings", path: "/admin/settings" },
];

const contentSubItems = [
  { label: "Posts & Pages", path: "/admin/posts" },
  { label: "Categories", path: "/admin/categories" },
  { label: "Tags", path: "/admin/tags" },
  { label: "Media", path: "/admin/media" },
];

const designSubItems = [
  { label: "Themes", path: "/admin/themes" },
  { label: "Customize", path: "/admin/design" },
];

const settingsSubItems = [
  { label: "Site Identity", path: "/admin/settings", exact: true },
  { label: "Navigation", path: "/admin/settings/navigation" },
  { label: "Social Links", path: "/admin/settings/social" },
  { label: "Search & Discovery", path: "/admin/settings/seo" },
  { label: "Widgets", path: "/admin/settings/widgets" },
  { label: "Users", path: "/admin/users" },
  { label: "AI", path: "/admin/settings/ai" },
];

const contentSection = ["/admin/posts", "/admin/categories", "/admin/tags", "/admin/media"];
const designSection = ["/admin/themes", "/admin/design"];
const settingsSection = ["/admin/settings", "/admin/users"];

function SubNav({ items }: { items: { label: string; path: string; exact?: boolean }[] }) {
  const pathname = usePathname();
  return (
    <div className="mt-0.5 ml-3 space-y-0.5 border-l border-zinc-200 dark:border-zinc-700 pl-3">
      {items.map(sub => {
        const isActive = sub.exact ? pathname === sub.path : pathname.startsWith(sub.path);
        return (
          <Link
            key={sub.path}
            href={sub.path}
            className={`block px-2 py-1.5 rounded-md text-xs transition-colors ${
              isActive
                ? "bg-zinc-100 text-zinc-900 font-medium dark:bg-zinc-800 dark:text-zinc-100"
                : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            }`}
          >
            {sub.label}
          </Link>
        );
      })}
    </div>
  );
}

export default function Sidebar({ isOpen, onClose, plugins = [], badges = {} }: Props) {
  const pathname = usePathname();
  const inContentSection = contentSection.some(p => pathname.startsWith(p));
  const inDesignSection = designSection.some(p => pathname.startsWith(p));
  const inPluginsSection = pathname.startsWith("/admin/plugins");
  const inSettingsSection = settingsSection.some(p => pathname.startsWith(p));

  const totalBadgeCount = Object.values(badges).reduce((sum, n) => sum + n, 0);

  const notificationPlugins = plugins.filter(p => p.actionHref);
  const inNotificationsSection =
    pathname.startsWith("/admin/notifications") ||
    notificationPlugins.some(p => p.actionHref && pathname.startsWith(p.actionHref));

  return (
    <aside
      className={`
        fixed inset-y-0 left-0 z-50 w-56 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 flex flex-col
        transform transition-transform duration-200 ease-in-out
        ${isOpen ? "translate-x-0" : "-translate-x-full"}
        lg:relative lg:translate-x-0 lg:z-auto
      `}
    >
      {/* Header */}
      <div className="h-14 px-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between shrink-0">
        <Link href="/admin" className="font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight text-base">
          Pugmill
        </Link>
        <button
          onClick={onClose}
          className="lg:hidden text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 p-1 rounded transition-colors"
          aria-label="Close menu"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {topNavItems.map((item) => {
          const isActive = item.exact
            ? pathname === item.path
            : pathname.startsWith(item.path) ||
              (item.path === "/admin/notifications" && inNotificationsSection);

          return (
            <div key={item.path}>
              <Link
                href={item.path}
                onClick={onClose}
                className={`flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? "bg-zinc-100 text-zinc-900 font-medium dark:bg-zinc-800 dark:text-zinc-100"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                }`}
              >
                {item.label}
                {item.path === "/admin/notifications" && totalBadgeCount > 0 && (
                  <span className="ml-auto text-xs bg-red-500 text-white rounded-full px-1.5 py-0.5 leading-none tabular-nums">
                    {totalBadgeCount > 99 ? "99+" : totalBadgeCount}
                  </span>
                )}
              </Link>

              {item.path === "/admin/notifications" && inNotificationsSection && notificationPlugins.length > 0 && (
                <div className="mt-0.5 ml-3 space-y-0.5 border-l border-zinc-200 dark:border-zinc-700 pl-3">
                  <Link
                    href="/admin/notifications"
                    className={`block px-2 py-1.5 rounded-md text-xs transition-colors ${
                      pathname === "/admin/notifications"
                        ? "bg-zinc-100 text-zinc-900 font-medium dark:bg-zinc-800 dark:text-zinc-100"
                        : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                    }`}
                  >
                    All Notifications
                  </Link>
                  {notificationPlugins.map(p => {
                    const href = p.actionHref!;
                    const badgeCount = badges[p.id] ?? 0;
                    const isActiveSub = pathname.startsWith(href);
                    return (
                      <Link
                        key={p.id}
                        href={href}
                        className={`flex items-center justify-between px-2 py-1.5 rounded-md text-xs transition-colors ${
                          isActiveSub
                            ? "bg-zinc-100 text-zinc-900 font-medium dark:bg-zinc-800 dark:text-zinc-100"
                            : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                        }`}
                      >
                        {p.name}
                        {badgeCount > 0 && (
                          <span className="ml-auto text-xs bg-red-500 text-white rounded-full px-1.5 py-0.5 leading-none tabular-nums">
                            {badgeCount > 99 ? "99+" : badgeCount}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
              {item.path === "/admin/posts" && inContentSection && (
                <SubNav items={contentSubItems} />
              )}
              {item.path === "/admin/design" && inDesignSection && (
                <SubNav items={designSubItems} />
              )}
              {item.path === "/admin/plugins" && inPluginsSection && (
                <div className="mt-0.5 ml-3 space-y-0.5 border-l border-zinc-200 dark:border-zinc-700 pl-3">
                  <Link
                    href="/admin/plugins"
                    className={`block px-2 py-1.5 rounded-md text-xs transition-colors ${
                      pathname === "/admin/plugins"
                        ? "bg-zinc-100 text-zinc-900 font-medium dark:bg-zinc-800 dark:text-zinc-100"
                        : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                    }`}
                  >
                    All Plugins
                  </Link>
                  {plugins.map(p => {
                    const pluginPath = `/admin/plugins/${p.id}`;
                    return (
                      <Link
                        key={p.id}
                        href={pluginPath}
                        className={`block px-2 py-1.5 rounded-md text-xs transition-colors ${
                          pathname === pluginPath
                            ? "bg-zinc-100 text-zinc-900 font-medium dark:bg-zinc-800 dark:text-zinc-100"
                            : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                        }`}
                      >
                        {p.name}
                      </Link>
                    );
                  })}
                </div>
              )}
              {item.path === "/admin/settings" && inSettingsSection && (
                <SubNav items={settingsSubItems} />
              )}
            </div>
          );
        })}
      </nav>

    </aside>
  );
}
