"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Module-level singleton — bridges the click handler (which starts the View
 * Transition) with the pathname effect (which completes it).
 */
let resolvePageTransition: (() => void) | null = null;

/**
 * Start a View Transition synchronously inside the click handler so the
 * browser captures the current DOM state as the "old" snapshot before React
 * updates anything. Falls back silently on unsupported browsers.
 */
function startCrossFade() {
  if (typeof document === "undefined") return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = (document as any).startViewTransition?.bind(document);
  if (typeof fn !== "function") return;
  fn(() =>
    new Promise<void>((resolve) => {
      resolvePageTransition = resolve;
      // Safety valve: always resolve after 2.5 s in case navigation stalls.
      setTimeout(() => {
        resolvePageTransition = null;
        resolve();
      }, 2500);
    })
  );
}

function completeCrossFade() {
  if (resolvePageTransition) {
    resolvePageTransition();
    resolvePageTransition = null;
  }
}

/**
 * Handles two concerns in one component:
 *  1. Thin top-of-page progress bar (for all navigations).
 *  2. View Transition cross-fade trigger (for browsers that support it).
 *
 * The cross-fade is resolved with an 80 ms delay after pathname changes —
 * this gives fast-loading pages time to render their real content so the
 * "new" snapshot captures the actual page instead of the loading skeleton.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [done, setDone] = useState(false);
  const [pct, setPct] = useState(0);
  const prevPath = useRef(pathname);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  function clearTimers() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }
  function schedule(fn: () => void, ms: number) {
    timers.current.push(setTimeout(fn, ms));
  }

  // ── Click handler ──────────────────────────────────────────────────────────
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
      if (!a || a.target) return;
      const href = a.getAttribute("href") ?? "";
      if (/^(https?:|\/\/|#|mailto:|tel:)/.test(href)) return;
      const dest = href.split(/[?#]/)[0];
      const curr = pathname.split(/[?#]/)[0];
      if (dest === curr) return;

      // MUST be called synchronously in the event handler so the browser
      // captures the current page as the "old" snapshot before React updates.
      startCrossFade();

      // Progress bar
      clearTimers();
      setDone(false);
      setVisible(true);
      setPct(18);
      schedule(() => setPct(45), 180);
      schedule(() => setPct(68), 500);
      schedule(() => setPct(82), 900);
    }
    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
      clearTimers();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // ── Pathname change → complete transition ──────────────────────────────────
  useEffect(() => {
    if (pathname === prevPath.current) return;
    prevPath.current = pathname;
    clearTimers();

    // Short pause before resolving: lets fast-loading pages commit their
    // real content so the "new" snapshot skips the loading skeleton entirely.
    schedule(completeCrossFade, 80);

    // Progress bar completion
    setPct(100);
    schedule(() => setDone(true), 200);
    schedule(() => { setVisible(false); setDone(false); setPct(0); }, 500);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (!visible) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[200] h-[2px] bg-medflow-500 transition-all ease-out"
      style={{
        width: `${pct}%`,
        opacity: done ? 0 : 1,
        transitionDuration: done ? "280ms" : pct >= 100 ? "160ms" : "380ms",
        boxShadow: done ? "none" : "0 0 8px 0 rgba(14,165,233,0.5)",
      }}
    />
  );
}
