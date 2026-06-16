"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Redistribution has been merged into the single Transfers workflow.
// Cross-facility admins now choose the sending facility directly in Send Transfer.
export default function RedistributionRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/transfers/send");
  }, [router]);
  return <p className="p-6 text-sm text-muted-foreground">Redistribution is now part of Transfers — redirecting…</p>;
}
