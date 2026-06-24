"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Renders its children into <body> via a portal so modal overlays escape any
 * transformed/animated ancestor (e.g. the app shell's page-transition wrapper).
 * Without this, `position: fixed` is trapped inside the main content area and the
 * overlay fails to cover the sidebar and header. SSR-safe: portals only after mount.
 */
export function ModalPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}
