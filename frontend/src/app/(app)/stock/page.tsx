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
    label: "Stock Report",
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
    description: "Process patient and facility returns",
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

  const visibleItems = HUB_ITEMS.filter((item) => can(user!.permissions, item.module, "view"));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Stock Management</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Central inventory hub — select an action below.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href}>
              <div className="group flex h-full flex-col gap-3 rounded-xl border bg-white p-4 transition hover:border-medflow-300 hover:shadow-sm">
                <span className={`w-fit rounded-lg p-2.5 ${item.color}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-semibold text-slate-800 group-hover:text-medflow-700">{item.label}</p>
                  <p className="mt-0.5 text-sm text-slate-500">{item.description}</p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
