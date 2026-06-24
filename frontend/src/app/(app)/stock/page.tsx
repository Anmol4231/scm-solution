"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ShoppingCart,
  PackageCheck,
  ArrowLeftRight,
  Scale,
  RotateCcw,
  AlertTriangle,
  History,
  BarChart3,
  Lock,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { can, type ModuleKey } from "@/lib/permissions";

interface HubItem {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  color: string;
  module: ModuleKey;
}

const HUB_ITEMS: HubItem[] = [
  {
    href: "/stock/in-hand",
    label: "Stock in Hand",
    description: "Real-time inventory across all batches",
    icon: BarChart3,
    color: "text-medflow-600 bg-medflow-50",
    module: "stock",
  },
  {
    href: "/stock/orders",
    label: "Orders",
    description: "Create, approve, and manage stock orders",
    icon: ShoppingCart,
    color: "text-blue-600 bg-blue-50",
    module: "orders",
  },
  {
    href: "/stock/receipt",
    label: "Receive Stock",
    description: "Receive pending orders, track partial deliveries, and view receipt history",
    icon: PackageCheck,
    color: "text-emerald-600 bg-emerald-50",
    module: "receiveStock",
  },
  {
    href: "/transfers",
    label: "Transfers",
    description: "Transfer stock between facilities",
    icon: ArrowLeftRight,
    color: "text-violet-600 bg-violet-50",
    module: "transfers",
  },
  {
    href: "/returns",
    label: "Returns",
    description: "Process facility returns",
    icon: RotateCcw,
    color: "text-rose-600 bg-rose-50",
    module: "returns",
  },
  {
    href: "/expiry",
    label: "Expiry Management",
    description: "Track and dispose of expiring stock",
    icon: AlertTriangle,
    color: "text-orange-600 bg-orange-50",
    module: "expiry",
  },
  {
    href: "/stock/adjustment",
    label: "Adjustments",
    description: "Physical count and stock corrections",
    icon: Scale,
    color: "text-amber-600 bg-amber-50",
    module: "stock",
  },
  {
    href: "/stock/transactions",
    label: "Transaction History",
    description: "Full audit log of stock movements",
    icon: History,
    color: "text-slate-600 bg-slate-100",
    module: "stock",
  },
];

const STOCK_MODULES: ModuleKey[] = ["stock", "orders", "receiveStock", "transfers", "returns", "expiry"];

export default function StockManagementPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const hasAnyAccess = !loading && !!user && STOCK_MODULES.some((m) => can(user.permissions, m, "view"));

  useEffect(() => {
    if (!loading && user && !hasAnyAccess) router.replace("/dashboard");
  }, [loading, user, hasAnyAccess, router]);

  if (!hasAnyAccess) return null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Stock Management</h1>
      </div>

      {/* All actions are shown; ones you cannot access are disabled (greyed out). */}
      <div className="grid auto-rows-fr gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {HUB_ITEMS.map((item) => {
          const Icon = item.icon;
          const allowed = can(user!.permissions, item.module, "view");

          const card = (
            <div
              className={`group relative flex h-full flex-col gap-3 rounded-xl border p-4 transition ${
                allowed
                  ? "bg-white hover:border-medflow-300 hover:shadow-sm"
                  : "cursor-not-allowed border-dashed bg-slate-50 opacity-60"
              }`}
            >
              <span className={`w-fit rounded-lg p-2.5 ${allowed ? item.color : "bg-slate-200 text-slate-400"}`}>
                <Icon className="h-5 w-5" />
              </span>
              <div>
                <p className={`font-semibold ${allowed ? "text-slate-800 group-hover:text-medflow-700" : "text-slate-500"}`}>
                  {item.label}
                </p>
                <p className="mt-0.5 text-sm text-slate-500">{item.description}</p>
              </div>
              {!allowed && (
                <span className="absolute right-3 top-3 inline-flex items-center gap-1 text-xs font-medium text-slate-400">
                  <Lock className="h-3.5 w-3.5" /> No access
                </span>
              )}
            </div>
          );

          return allowed ? (
            <Link key={item.href} href={item.href}>{card}</Link>
          ) : (
            <div key={item.href} aria-disabled title="You don't have access to this action">{card}</div>
          );
        })}
      </div>
    </div>
  );
}
