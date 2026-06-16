"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { can, type ModuleKey, type ActionKey } from "@/lib/permissions";

/**
 * Redirect to /dashboard when the user lacks ALL of the given permissions.
 * Access is granted if the user has view access to ANY of the listed modules.
 */
export function useRequireAnyPermission(modules: ModuleKey[], action: ActionKey = "view"): boolean {
  const { user, loading } = useAuth();
  const router = useRouter();

  const hasAny = user ? modules.some((m) => can(user.permissions, m, action)) : false;

  useEffect(() => {
    if (!loading && user && !hasAny) {
      router.replace("/dashboard");
    }
  }, [loading, user, hasAny, router]);

  if (loading || !user) return false;
  return hasAny;
}
