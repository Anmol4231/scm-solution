"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { isMasterDataAdminRole } from "@/lib/roles";
import { UserForm } from "@/components/users/user-form";

export default function NewUserPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const isAdmin = isMasterDataAdminRole(user?.role);

  useEffect(() => {
    if (!loading && !isAdmin) router.replace("/dashboard");
  }, [loading, isAdmin, router]);

  if (!isAdmin) return null;

  return (
    <div className="space-y-5">
      <Link href="/users" className="text-sm text-medflow-600 hover:underline">← Users &amp; Access</Link>
      <h1 className="text-2xl font-bold">Add User</h1>
      <UserForm mode="new" />
    </div>
  );
}
