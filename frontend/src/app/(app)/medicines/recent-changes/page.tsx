"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isMasterDataAdminRole } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ChangeRecord {
  id: string;
  entityId?: string | null;
  entityType: "Medicine" | "MedicineCategory";
  recordName: string;
  changeType: "Created" | "Updated" | "Deleted" | "Restored" | string;
  changedBy: string;
  createdAt: string;
  canRestore: boolean;
}

const nav = [
  { href: "/medicines", label: "Medicine Master" },
  { href: "/medicines/categories", label: "Categories" },
  { href: "/medicines/recent-changes", label: "Recent Changes" },
];

export default function RecentChangesPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const isAdmin = isMasterDataAdminRole(user?.role);
  const [changes, setChanges] = useState<ChangeRecord[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = () => api<ChangeRecord[]>("/medicines/recent-changes").then(setChanges).catch((err) => setError(err.message));

  useEffect(() => {
    if (!loading && !isAdmin) {
      router.replace("/medicines");
      return;
    }
    if (isAdmin) load();
  }, [isAdmin, loading, router]);

  const restore = async (change: ChangeRecord) => {
    if (!change.entityId) return;
    setError("");
    setSuccess("");
    try {
      const endpoint =
        change.entityType === "Medicine"
          ? `/medicines/${change.entityId}/restore`
          : `/categories/${change.entityId}/restore`;
      await api(endpoint, { method: "POST" });
      setSuccess(`${change.recordName} restored`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore record");
    }
  };

  if (!isAdmin) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Recent Changes</h1>
        <p className="text-sm text-muted-foreground">Audit history for medicine and category master data.</p>
      </div>

      <div className="flex gap-2 overflow-x-auto border-b">
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`whitespace-nowrap border-b-2 px-2 py-2 text-sm font-medium ${
              item.href === "/medicines/recent-changes"
                ? "border-medflow-600 text-medflow-700"
                : "border-transparent text-slate-600"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {success && <p className="rounded-lg bg-green-50 p-3 text-green-700">{success}</p>}

      <Card>
        <CardHeader><CardTitle className="text-base">Audit History</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left">
                <th className="p-3">Record Name</th>
                <th className="p-3">Change Type</th>
                <th className="p-3">Changed By</th>
                <th className="p-3">Date/Time</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((change) => (
                <tr key={change.id} className="border-b hover:bg-slate-50/70">
                  <td className="p-3">
                    <p className="font-medium">{change.recordName}</p>
                    <p className="text-xs text-muted-foreground">
                      {change.entityType === "MedicineCategory" ? "Category" : "Medicine"}
                    </p>
                  </td>
                  <td className="p-3">{change.changeType}</td>
                  <td className="p-3 text-slate-600">{change.changedBy}</td>
                  <td className="p-3 text-slate-600">{new Date(change.createdAt).toLocaleString()}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2">
                      {change.entityId && change.entityType === "Medicine" && (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/medicines/${change.entityId}`}>View Details</Link>
                        </Button>
                      )}
                      {change.canRestore && (
                        <Button type="button" size="sm" variant="outline" onClick={() => restore(change)}>
                          <RotateCcw className="mr-1 h-3.5 w-3.5" /> Restore
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {changes.length === 0 && (
                <tr>
                  <td className="p-6 text-center text-muted-foreground" colSpan={5}>No recent changes found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
