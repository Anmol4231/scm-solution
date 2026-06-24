"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Pill,
  Syringe,
  UserPlus,
  Tags,
  Bell,
  Package,
  ShieldCheck,
  Building2,
  ScrollText,
  Settings,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { isAdminDashboardRole, isMasterDataAdminRole, simpleRoleLabel } from "@/lib/roles";
import { can, type ModuleKey, type PermissionMatrix } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { GlobalSearch } from "@/components/layout/global-search";
import { NavigationProgress } from "@/components/layout/navigation-progress";
import { useOffline } from "@/lib/offline/offline-context";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Route not built yet — rendered disabled with a "Soon" badge. */
  soon?: boolean;
  /** Only visible to master-data admins (enum guard, runs before permission check). */
  adminOnly?: boolean;
  /** Permission module required — item is hidden when user lacks view access. */
  module?: ModuleKey;
  /** Show if user has view access to ANY of these modules. */
  moduleAny?: ModuleKey[];
};

type NavSection = { title?: string; items: NavItem[] };

/**
 * Offline/sync UI is built and working but intentionally hidden for now.
 * Flip to `true` to re-enable the top banner and the nav sync badge.
 * (The /sync page and offline engine remain fully wired up.)
 */
const SHOW_OFFLINE_UI = false;

function buildNav(
  isMasterAdmin: boolean,
  isCrossFacilityAdmin: boolean,
  permissions: PermissionMatrix | undefined
): NavSection[] {
  const hasView = (module: ModuleKey) => can(permissions, module, "view");

  return ([
    {
      title: "Dashboard",
      items: isCrossFacilityAdmin
        ? [
            { href: "/admin", label: "Dashboard", icon: LayoutDashboard, module: "dashboard" as ModuleKey },
            { href: "/alerts", label: "Alert Center", icon: Bell, module: "alerts" as ModuleKey },
          ]
        : [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, module: "dashboard" as ModuleKey }],
    },
    {
      title: "Masters",
      items: [
        { href: "/masters/roles", label: "Role Master", icon: ShieldCheck, adminOnly: true, module: "roles" as ModuleKey },
        { href: "/masters/facilities", label: "Facility Master", icon: Building2, adminOnly: true, module: "facilities" as ModuleKey },
        { href: "/users", label: "Users & Access", icon: UserPlus, adminOnly: true, module: "users" as ModuleKey },
        { href: "/medicines/categories", label: "Stock Categories", icon: Tags, module: "stockCategories" as ModuleKey },
        { href: "/medicines", label: "Medicines", icon: Pill, module: "medicines" as ModuleKey },
      ],
    },
    {
      title: "Inventory",
      items: [
        { href: "/stock", label: "Stock Management", icon: Package, moduleAny: ["stock", "orders", "receiveStock", "transfers", "returns", "expiry"] as ModuleKey[] },
      ],
    },
    {
      title: "Patients",
      items: [
        { href: "/dispense", label: "Dispensing", icon: Syringe, module: "dispensing" as ModuleKey },
      ],
    },
    {
      title: "Administration",
      items: [
        { href: "/settings/audit", label: "Audit Logs", icon: ScrollText, adminOnly: true, module: "audit" as ModuleKey },
        { href: "/settings", label: "User Settings", icon: Settings },
      ],
    },
  ] as NavSection[])
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          (!item.adminOnly || isMasterAdmin) &&
          (!item.module || hasView(item.module)) &&
          (!item.moduleAny || item.moduleAny.some((m) => hasView(m)))
      ),
    }))
    .filter((section) => section.items.length > 0);
}

/** Among all nav hrefs, the longest prefix match wins — keeps /medicines from lighting up on /medicines/categories. */
function resolveActiveHref(pathname: string, hrefs: string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    if (pathname === href || pathname.startsWith(href + "/")) {
      if (!best || href.length > best.length) best = href;
    }
  }
  return best;
}

const mobileNav: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dispense", label: "Dispensing", icon: Syringe },
  { href: "/medicines", label: "Medicines", icon: Pill },
  { href: "/stock", label: "Stock", icon: Package },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Bumping this remounts the page subtree (see <main> below), wiping all
  // local component state for the target module — a fresh/default view on
  // every nav click, even when the route is unchanged. Auth/offline state
  // lives above <main>, so it is untouched.
  const [resetNonce, setResetNonce] = useState(0);
  const { isOnline, pendingCount } = useOffline();

  // Shared by every in-shell nav control (sidebar items, section headers,
  // mobile tabs). The <Link> still navigates to the clean, param-less href
  // (clearing URL query state); this additionally forces a module reset.
  function resetModule(e: React.MouseEvent) {
    setOpen(false);
    // Let the browser handle "open in new tab" / modified clicks without
    // resetting the view the user is leaving behind.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    setResetNonce((n) => n + 1);
  }
  const isMasterAdmin = isMasterDataAdminRole(user?.role);
  const isCrossFacilityAdmin = isAdminDashboardRole(user?.role);
  const sections = buildNav(isMasterAdmin, isCrossFacilityAdmin, user?.permissions);

  const allHrefs = sections.flatMap((s) => s.items.filter((i) => !i.soon).map((i) => i.href));
  const activeHref = resolveActiveHref(pathname, allHrefs);
  const mobileActiveHref = resolveActiveHref(pathname, mobileNav.map((i) => i.href));

  return (
    <div className="min-h-screen bg-slate-50">
      <NavigationProgress />
      {SHOW_OFFLINE_UI && (!isOnline || pendingCount > 0) && (
        <div
          className={cn(
            "border-b px-4 py-1.5 text-center text-sm font-medium",
            isOnline ? "border-amber-200 bg-amber-50 text-amber-800" : "border-red-200 bg-red-50 text-red-800"
          )}
        >
          {isOnline ? (
            <>🟡 {pendingCount} change(s) waiting to sync — <Link href="/sync" className="underline">View queue</Link></>
          ) : (
            <>🔴 Working offline — changes will sync automatically when connection returns</>
          )}
        </div>
      )}

      <header className="sticky top-0 z-40 border-b bg-white px-4 py-3 shadow-sm sm:px-6">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button className="md:hidden" onClick={() => setOpen(!open)} aria-label="Menu">
              {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
            <Link
              href="/dashboard"
              className="flex shrink-0 items-center gap-2"
              aria-label="StockTrackRx home"
            >
              <img
                src="/icons/stocktrackrx-emblem.png"
                alt=""
                className="h-9 w-9 object-contain"
              />
              <span className="text-xl font-extrabold tracking-tight">
                <span className="text-[#1a3a6e]">Stock</span>
                <span className="text-green-600">TrackRx</span>
              </span>
            </Link>
          </div>
          <div className="hidden max-w-sm flex-1 md:block lg:max-w-md">
            <GlobalSearch />
          </div>
          <div className="text-right text-sm">
            <p className="font-medium">{user?.firstName} {user?.lastName}</p>
            <p className="text-muted-foreground text-sm">
              {user?.facility?.name || simpleRoleLabel(user?.role)}
            </p>
          </div>
        </div>
      </header>

      {open && (
        <button
          type="button"
          className="fixed inset-0 z-20 bg-slate-950/30 md:hidden"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}

      <div className="mx-auto flex max-w-[1600px]">
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-30 w-72 max-w-[85vw] border-r bg-white pt-16 shadow-xl transition-transform md:static md:w-64 md:max-w-none md:translate-x-0 md:pt-0 md:shadow-none",
            open ? "translate-x-0" : "-translate-x-full md:translate-x-0"
          )}
        >
          <nav className="flex max-h-[calc(100vh-4rem)] flex-col gap-0.5 overflow-y-auto p-3 pb-24 md:max-h-none md:pb-3">
            {sections.map((section, si) => {
              // The section's default landing page: the first item the user can
              // actually reach. buildNav already filtered items by RBAC and keeps
              // the intended default first, so items[0] is the default — or the
              // first accessible fallback when the default is denied.
              const sectionTarget = section.items.find((i) => !i.soon)?.href ?? null;
              const sectionActive = section.items.some((i) => !i.soon && i.href === activeHref);
              return (
              <div key={section.title ?? `section-${si}`} className="flex flex-col gap-0.5">
                {section.title &&
                  (sectionTarget ? (
                    <Link
                      href={sectionTarget}
                      onClick={resetModule}
                      className={cn(
                        "rounded-md px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider transition-colors",
                        sectionActive ? "text-medflow-600" : "text-slate-400 hover:text-slate-600"
                      )}
                    >
                      {section.title}
                    </Link>
                  ) : (
                    <p className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      {section.title}
                    </p>
                  ))}
                {section.items.map((item) => {
                  const Icon = item.icon;
                  if (item.soon) {
                    return (
                      <div
                        key={item.href}
                        title="Coming soon"
                        className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300"
                      >
                        <Icon className="h-5 w-5 shrink-0" />
                        {item.label}
                        <span className="ml-auto rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">
                          Soon
                        </span>
                      </div>
                    );
                  }
                  const active = item.href === activeHref;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={resetModule}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                        active ? "bg-medflow-50 text-medflow-700" : "text-slate-600 hover:bg-slate-100"
                      )}
                    >
                      <Icon className="h-5 w-5 shrink-0" />
                      {item.label}
                      {SHOW_OFFLINE_UI && item.href === "/sync" && pendingCount > 0 && (
                        <span className="ml-auto rounded-full bg-amber-500 px-1.5 text-[10px] text-white">
                          {pendingCount}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
              );
            })}
            <Button variant="ghost" className="mt-3 justify-start gap-3" onClick={logout}>
              <LogOut className="h-5 w-5" /> Logout
            </Button>
          </nav>
        </aside>

        <main className="vt-page-content min-h-[calc(100vh-4rem)] min-w-0 flex-1 p-3 pb-28 sm:p-4 md:p-6 md:pb-6">
          {/* key={resetNonce} → a nav click remounts this subtree, resetting
              every module's local state. animate-in gives a subtle fade on
              every navigation, including same-route resets. */}
          <div key={resetNonce} className="animate-in fade-in-0 duration-150">
            {children}
          </div>
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-2 pb-[calc(0.35rem+env(safe-area-inset-bottom))] pt-1.5 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur md:hidden">
        <div className="grid grid-cols-5 gap-1">
          {mobileNav.map((item) => {
            const Icon = item.icon;
            const active = item.href === mobileActiveHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={resetModule}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[10px] font-medium leading-tight transition-colors",
                  active ? "bg-medflow-50 text-medflow-700" : "text-slate-500 hover:bg-slate-100"
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className="max-w-full truncate">{item.label.replace("Patient ", "")}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
