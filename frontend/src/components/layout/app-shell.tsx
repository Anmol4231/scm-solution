"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Pill,
  Package,
  ClipboardList,
  AlertTriangle,
  ArrowLeftRight,
  RotateCcw,
  LogOut,
  Menu,
  X,
  CloudOff,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { isAdminDashboardRole } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { GlobalSearch } from "@/components/layout/global-search";
import { useOffline } from "@/lib/offline/offline-context";

const facilityNav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/patients", label: "Patients", icon: Users },
  { href: "/healthcare-workers", label: "Staff", icon: Users },
  { href: "/dispense", label: "Patient Dispense", icon: Pill },
  { href: "/prescriptions", label: "Prescriptions", icon: ClipboardList },
  { href: "/medicines", label: "Medicines", icon: Pill },
  { href: "/stock", label: "Stock", icon: Package },
  { href: "/expiry", label: "Expiry", icon: AlertTriangle },
  { href: "/returns", label: "Returns", icon: RotateCcw },
  { href: "/transfers", label: "Transfers", icon: ArrowLeftRight },
  { href: "/sync", label: "Pending Sync", icon: CloudOff },
];

const adminNav = [
  { href: "/admin", label: "Admin Dashboard", icon: LayoutDashboard },
  { href: "/admin/transfers", label: "Redistribution", icon: ArrowLeftRight },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { isOnline, pendingCount } = useOffline();
  const isAdmin = isAdminDashboardRole(user?.role);
  const nav = isAdmin ? [...adminNav, ...facilityNav.slice(1)] : facilityNav;
  const mobileNav = isAdmin
    ? nav.slice(0, 5)
    : [
        facilityNav[0],
        facilityNav[1],
        facilityNav[3],
        facilityNav[6],
        facilityNav[10],
      ];

  return (
    <div className="min-h-screen bg-slate-50">
      {(!isOnline || pendingCount > 0) && (
        <div
          className={cn(
            "border-b px-4 py-1.5 text-center text-xs font-medium",
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

      <header className="sticky top-0 z-40 border-b bg-white px-4 py-3 shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button className="md:hidden" onClick={() => setOpen(!open)} aria-label="Menu">
              {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
            <Link href="/dashboard" className="font-bold text-medflow-700">
              SCM Solution
            </Link>
            <span
              className={cn(
                "hidden rounded-full px-2 py-0.5 text-[10px] font-semibold sm:inline",
                isOnline ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
              )}
              title={isOnline ? "Online" : "Offline Mode"}
            >
              {isOnline ? "🟢 Online" : "🔴 Offline"}
            </span>
          </div>
          <div className="hidden max-w-sm flex-1 md:block">
            <GlobalSearch />
          </div>
          <div className="text-right text-sm">
            <p className="font-medium">{user?.firstName} {user?.lastName}</p>
            <p className="text-muted-foreground text-xs">
              {user?.facility?.name || (user?.role === "SUPER_ADMIN" ? "Super Admin" : "Provincial Manager")}
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

      <div className="mx-auto flex max-w-6xl">
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-30 w-72 max-w-[85vw] border-r bg-white pt-16 shadow-xl transition-transform md:static md:w-64 md:max-w-none md:translate-x-0 md:pt-0 md:shadow-none",
            open ? "translate-x-0" : "-translate-x-full md:translate-x-0"
          )}
        >
          <nav className="flex max-h-[calc(100vh-4rem)] flex-col gap-0.5 overflow-y-auto p-3 pb-24 md:max-h-none md:pb-3">
            {nav.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    active ? "bg-medflow-50 text-medflow-700" : "text-slate-600 hover:bg-slate-100"
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  {item.label}
                  {item.href === "/sync" && pendingCount > 0 && (
                    <span className="ml-auto rounded-full bg-amber-500 px-1.5 text-[10px] text-white">
                      {pendingCount}
                    </span>
                  )}
                </Link>
              );
            })}
            <Button variant="ghost" className="mt-3 justify-start gap-3" onClick={logout}>
              <LogOut className="h-5 w-5" /> Logout
            </Button>
          </nav>
        </aside>

        <main className="min-h-[calc(100vh-4rem)] min-w-0 flex-1 p-3 pb-28 sm:p-4 md:p-6 md:pb-6">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-2 pb-[calc(0.35rem+env(safe-area-inset-bottom))] pt-1.5 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur md:hidden">
        <div className="grid grid-cols-5 gap-1">
          {mobileNav.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
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
