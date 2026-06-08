"use client";

import { useState } from "react";
import { ShieldAlert, LogOut } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Hard gate shown whenever the signed-in user still has `mustChangePassword`.
 * It replaces the entire app — no navigation, shell, or routes are reachable
 * until the password is changed (which clears the flag server-side).
 */
export function ForcePasswordChange() {
  const { user, logout, refreshUser } = useAuth();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (form.newPassword.length < 6) return setError("New password must be at least 6 characters");
    if (form.newPassword !== form.confirm) return setError("New passwords do not match");
    if (form.newPassword === form.currentPassword) return setError("New password must differ from the temporary one");
    setBusy(true);
    try {
      await api("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword }),
      });
      // Clears mustChangePassword in the session → AuthGuard renders the app.
      await refreshUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password");
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2 text-amber-700">
          <ShieldAlert className="h-5 w-5" />
          <h1 className="text-lg font-bold">Set a new password</h1>
        </div>
        <p className="mb-5 text-sm text-muted-foreground">
          {user ? <span className="font-medium text-slate-700">{user.firstName} {user.lastName}</span> : "You"}, you’re signed in with a
          temporary password. Choose a new password to continue — access to the app is locked until you do.
        </p>

        {error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label>Temporary password</Label>
            <Input
              type="password"
              autoComplete="current-password"
              value={form.currentPassword}
              onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
              required
            />
          </div>
          <div>
            <Label>New password</Label>
            <Input
              type="password"
              autoComplete="new-password"
              value={form.newPassword}
              onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
              required
            />
          </div>
          <div>
            <Label>Confirm new password</Label>
            <Input
              type="password"
              autoComplete="new-password"
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Updating…" : "Change password & continue"}
          </Button>
        </form>

        <button
          type="button"
          onClick={logout}
          className="mt-4 flex w-full items-center justify-center gap-2 text-sm text-slate-500 hover:text-slate-700"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    </div>
  );
}
