/**
 * Header — server component
 *
 * Fetches site config and passes the site name + nav items to HeaderClient.
 * Keep this file as a server component so it can access the database/config
 * without making the entire header a client boundary.
 *
 * See /themes/default/components/Header.tsx for a reference implementation.
 */

import { getConfig } from "../../../src/lib/config";
import { hooks } from "../../../src/lib/hooks";
import HeaderClient from "./HeaderClient";

export default async function Header() {
  const config = await getConfig();

  const siteName = config.site?.name ?? "My Site";
  const logoUrl = config.site?.logo ?? null;

  // Pass nav items through the "nav:items" filter so plugins can add,
  // remove, or reorder navigation entries without modifying this file.
  const rawNavItems = (config.appearance?.navigation as { label: string; path: string }[]) ?? [];
  const navItems = await hooks.applyFilters("nav:items", { input: rawNavItems });

  return (
    <HeaderClient
      siteName={siteName}
      logoUrl={logoUrl}
      headerIdentity={config.site.headerIdentity ?? "logo-only"}
      navItems={navItems}
    />
  );
}
