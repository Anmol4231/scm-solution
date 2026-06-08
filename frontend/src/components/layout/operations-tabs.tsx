"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Syringe, Users, ClipboardList } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/dispense", label: "Dispense", icon: Syringe },
  { href: "/patients", label: "Patients", icon: Users },
  { href: "/prescriptions", label: "Prescriptions", icon: ClipboardList },
];

/** Shared header for the unified Operations workspace (Dispense · Patients · Prescriptions). */
export function OperationsTabs() {
  const pathname = usePathname();
  return (
    <div className="flex gap-1 overflow-x-auto border-b">
      {TABS.map((t) => {
        const Icon = t.icon;
        const active = pathname === t.href || pathname.startsWith(t.href + "/");
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
