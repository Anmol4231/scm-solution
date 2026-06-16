"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Syringe, Users, ClipboardList, BarChart3 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/dispense", label: "Dispense", icon: Syringe },
  { href: "/patients", label: "Patient Log", icon: Users },
  { href: "/prescriptions", label: "Prescription Log", icon: ClipboardList },
  { href: "/dispense/log", label: "Dispensing Report", icon: BarChart3 },
];

/** Shared header for the unified Operations workspace (Dispense · Patient Log · Prescription Log · Dispensing Report). */
export function OperationsTabs() {
  const pathname = usePathname();
  // Longest prefix wins so /dispense/log doesn't also light up /dispense.
  const activeHref = TABS
    .filter((t) => pathname === t.href || pathname.startsWith(t.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <div className="flex gap-1 overflow-x-auto border-b">
      {TABS.map((t) => {
        const Icon = t.icon;
        const active = t.href === activeHref;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active ? "border-medflow-600 text-medflow-700" : "border-transparent text-slate-500 hover:text-slate-800"
            )}
          >
            <Icon className="h-4 w-4" />
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
