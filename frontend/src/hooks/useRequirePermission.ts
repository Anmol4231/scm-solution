"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { can, type ModuleKey, type ActionKey } from "@/lib/permissions";

/**
 * Redirect to /dashboard when the current user lacks the given permission.
 * Returns true once access is confirmed, false while loading or when access is denied.
 */
export function useRequirePermission(module: ModuleKey, action: ActionKey = "view"): boolean {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user && !can(user.permissions, module, action)) {
      router.replace("/dashboard");
    }
  }, [loading, user, module, action, router]);

  if (loading || !user) return false;
  return can(user.permissions, module, action);
}
