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
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

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
];

const adminNav = [
  { href: "/admin", label: "Admin Dashboard", icon: LayoutDashboard },
  { href: "/admin/transfers", label: "Redistribution", icon: ArrowLeftRight },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isAdmin = user?.role === "PROVINCIAL_MANAGER";
  const nav = isAdmin ? [...adminNav, ...facilityNav.slice(1)] : facilityNav;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-40 border-b bg-white px-4 py-3 shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-3">
            <button className="md:hidden" onClick={() => setOpen(!open)} aria-label="Menu">
              {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
            <Link href="/dashboard" className="font-bold text-medflow-700">
              SCM Solution
            </Link>
          </div>
          <div className="text-right text-sm">
            <p className="font-medium">{user?.firstName} {user?.lastName}</p>
            <p className="text-muted-foreground">
              {user?.facility?.name || "Provincial Manager"}
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl">
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-30 w-64 transform border-r bg-white pt-16 transition md:static md:translate-x-0 md:pt-0",
            open ? "translate-x-0" : "-translate-x-full md:translate-x-0"
          )}
        >
          <nav className="flex flex-col gap-1 p-3">
            {nav.map((item) => {
              const Icon = item.icon;
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition",
                    active ? "bg-medflow-50 text-medflow-700" : "text-slate-600 hover:bg-slate-100"
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {item.label}
                </Link>
              );
            })}
            <Button variant="ghost" className="mt-4 justify-start gap-3" onClick={logout}>
              <LogOut className="h-5 w-5" /> Logout
            </Button>
          </nav>
        </aside>

        <main className="min-h-[calc(100vh-4rem)] flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
