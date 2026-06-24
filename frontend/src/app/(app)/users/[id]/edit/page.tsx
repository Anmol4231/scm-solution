"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isMasterDataAdminRole } from "@/lib/roles";
import { UserForm } from "@/components/users/user-form";
import type { ManagedUser } from "@/lib/users";

export default function EditUserPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const isAdmin = isMasterDataAdminRole(user?.role);
  const [target, setTarget] = useState<ManagedUser | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && !isAdmin) { router.replace("/dashboard"); return; }
    if (isAdmin && params.id) {
      api<ManagedUser>(`/users/${params.id}`)
        .then(setTarget)
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load user"));
    }
  }, [isAdmin, loading, params.id, router]);

  if (!isAdmin) return null;

  return (
    <div className="space-y-5">
      <Link href="/users" className="text-sm text-medflow-600 hover:underline">← Users &amp; Access</Link>
      <h1 className="text-2xl font-bold">Edit User</h1>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {target ? (
        <UserForm mode="edit" initial={target} />
      ) : (
        !error && <p className="text-sm text-muted-foreground">Loading…</p>
      )}
    </div>
  );
}
