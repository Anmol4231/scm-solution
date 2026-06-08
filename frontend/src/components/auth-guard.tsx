"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/layout/app-shell";
import { ScmAssistant } from "@/components/chat/scm-assistant";
import { OfflineProvider } from "@/lib/offline/offline-context";
import { ForcePasswordChange } from "@/components/force-password-change";
import { getToken } from "@/lib/api";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && (!user || !getToken())) {
      router.replace("/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!user) return null;

  // Hard gate: a user on a temporary password cannot reach any app route
  // until they set a new password (which clears mustChangePassword server-side).
  if (user.mustChangePassword) {
    return <ForcePasswordChange />;
  }

  return (
    <OfflineProvider>
      <AppShell>{children}</AppShell>
      <ScmAssistant />
    </OfflineProvider>
  );
}
