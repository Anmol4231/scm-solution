"use client";

import Link from "next/link";
import {
  ShoppingCart,
  Truck,
  ArrowLeftRight,
  Scale,
  RotateCcw,
  AlertTriangle,
  History,
  BarChart3,
  ClipboardList,
  type LucideIcon,
} from "lucide-react";

interface HubItem {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  color: string;
}

const HUB_ITEMS: HubItem[] = [
  {
    href: "/stock/in-hand",
    label: "Stock Report",
    description: "Real-time inventory across all batches",
    icon: BarChart3,
    color: "text-medflow-600 bg-medflow-50",
  },
  {
    href: "/requisitions",
    label: "Requisitions",
    description: "Request stock from AMS or supply stores",
    icon: ClipboardList,
    color: "text-indigo-600 bg-indigo-50",
  },
  {
    href: "/stock/orders",
    label: "Vendor Orders",
    description: "Place and manage external vendor orders",
    icon: ShoppingCart,
    color: "text-blue-600 bg-blue-50",
  },
  {
    href: "/stock/pending-receipts",
    label: "Pending Receipts",
    description: "Vouchers and orders waiting to be received",
    icon: Truck,
    color: "text-emerald-600 bg-emerald-50",
  },
  {
    href: "/transfers",
    label: "Transfers",
    description: "Transfer stock between facilities",
    icon: ArrowLeftRight,
    color: "text-violet-600 bg-violet-50",
  },
  {
    href: "/returns",
    label: "Returns",
    description: "Process patient and facility returns",
    icon: RotateCcw,
    color: "text-rose-600 bg-rose-50",
  },
  {
    href: "/expiry",
    label: "Expiry Management",
    description: "Track and dispose of expiring stock",
    icon: AlertTriangle,
    color: "text-orange-600 bg-orange-50",
  },
  {
    href: "/stock/adjustment",
    label: "Adjustments",
    description: "Physical count and stock corrections",
    icon: Scale,
    color: "text-amber-600 bg-amber-50",
  },
  {
    href: "/stock/movement",
    label: "Stock Movement",
    description: "Opening + receipts − issues = closing balance",
    icon: BarChart3,
    color: "text-teal-600 bg-teal-50",
  },
  {
    href: "/stock/transactions",
    label: "Transaction History",
    description: "Full audit log of stock movements",
    icon: History,
    color: "text-slate-600 bg-slate-100",
  },
];

export default function StockManagementPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Stock Management</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Central inventory hub — select an action below.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {HUB_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href}>
              <div className="group flex h-full flex-col gap-3 rounded-xl border bg-white p-4 transition hover:border-medflow-300 hover:shadow-sm">
                <span className={`w-fit rounded-lg p-2.5 ${item.color}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-semibold text-slate-800 group-hover:text-medflow-700">
                    {item.label}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
