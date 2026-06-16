"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ReceivedOrdersRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/stock/receipt?tab=all"); }, [router]);
  return null;
}
