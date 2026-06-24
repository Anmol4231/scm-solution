"use client";

import { useState } from "react";
import { AlertTriangle, Check, Copy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModalPortal } from "@/components/ui/modal-portal";
import type { TempPasswordInfo } from "@/lib/users";

/**
 * Centered modal that surfaces a freshly generated credential (new user or
 * password reset). Rendered as a fixed overlay so it is always in view — the
 * admin never has to scroll to find the password.
 */
export function PasswordResultDialog({
  info,
  onClose,
}: {
  info: TempPasswordInfo | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  if (!info) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(info.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="w-full max-w-md rounded-xl border bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-base font-semibold text-slate-800">Temporary password</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <p className={`text-sm ${info.emailWarning ? "text-amber-800" : "text-slate-600"}`}>
            {info.emailWarning ? (
              <>
                <AlertTriangle className="mr-1.5 inline h-4 w-4 align-text-bottom text-amber-500" />
                {info.emailWarning}
              </>
            ) : info.emailSent ? (
              <>Credentials were emailed to &ldquo;{info.name}&rdquo;. Share the password below as a backup.</>
            ) : (
              <>Temporary password for &ldquo;{info.name}&rdquo; — share this directly.</>
            )}
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-lg border bg-slate-50 px-3 py-2 font-mono text-sm">{info.password}</code>
            <Button size="sm" variant="outline" onClick={copy} aria-label="Copy password">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        <div className="flex justify-end border-t px-5 py-3">
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
