"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// User management is consolidated into Masters › Users & Access (/users).
// This route is kept only to redirect any lingering links there.
export default function LegacyUserManagementRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/users");
  }, [router]);
  return <p className="p-6 text-sm text-muted-foreground">Redirecting to Users &amp; Access…</p>;
}
