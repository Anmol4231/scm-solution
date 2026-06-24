"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { sanitizePersonName, sanitizePhone, validators } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import type { Facility, ManagedUser, RoleOption, TempPasswordInfo } from "@/lib/users";
import { PasswordResultDialog } from "@/components/users/password-result-dialog";

const EXPIRY_PRESETS = [
  { value: "0", label: "Never" },
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
  { value: "180", label: "180 days" },
  { value: "custom", label: "Custom…" },
];

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  roleId: string;
  /** "all" = access all facilities; "assigned" = single facility (requires facilityId). */
  facilityAccess: "all" | "assigned";
  facilityId: string;
  phone: string;
  mustChangePassword: boolean;
  expiryPreset: string;
  customExpiry: string;
}

const EMPTY_FORM: FormState = {
  firstName: "", lastName: "", email: "", roleId: "",
  facilityAccess: "assigned", facilityId: "", phone: "",
  mustChangePassword: true, expiryPreset: "0", customExpiry: "",
};

function expiryToDays(form: FormState): number | null {
  if (form.expiryPreset === "0") return null;
  if (form.expiryPreset === "custom") return form.customExpiry ? parseInt(form.customExpiry, 10) : null;
  return parseInt(form.expiryPreset, 10);
}

function daysToPreset(days?: number | null): { preset: string; custom: string } {
  if (!days) return { preset: "0", custom: "" };
  if (["30", "60", "90", "180"].includes(String(days))) return { preset: String(days), custom: "" };
  return { preset: "custom", custom: String(days) };
}

function formFromUser(u: ManagedUser): FormState {
  const { preset, custom } = daysToPreset(u.passwordExpiryDays);
  return {
    firstName: u.firstName, lastName: u.lastName, email: u.email,
    roleId: u.roleId ?? "",
    facilityAccess: u.facilityId ? "assigned" : "all",
    facilityId: u.facilityId ?? "",
    phone: u.phone ?? "",
    mustChangePassword: u.mustChangePassword, expiryPreset: preset, customExpiry: custom,
  };
}

export function UserForm({ mode, initial }: { mode: "new" | "edit"; initial?: ManagedUser }) {
  const router = useRouter();
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [form, setForm] = useState<FormState>(initial ? formFromUser(initial) : EMPTY_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<TempPasswordInfo | null>(null);

  useEffect(() => {
    api<Facility[]>("/auth/facilities").then(setFacilities).catch(console.error);
    api<RoleOption[]>("/roles").then((r) => setRoles(r.filter((x) => x.isActive))).catch(console.error);
  }, []);

  const spansAll = form.facilityAccess === "all";

  const validate = (): string => {
    const f = validators.personName(form.firstName, "First name"); if (f) return f;
    const l = validators.personName(form.lastName, "Last name"); if (l) return l;
    const e = validators.email(form.email); if (e) return e;
    const p = validators.phone(form.phone); if (p) return p;
    if (!form.roleId) return "Please select a role";
    if (!spansAll && !form.facilityId) return "Please assign a location for this role";
    if (form.expiryPreset === "custom" && !form.customExpiry) return "Enter the custom expiry in days";
    return "";
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const v = validate();
    if (v) return setError(v);

    const payload = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
      roleId: form.roleId,
      accessAllFacilities: spansAll,
      facilityId: spansAll ? "" : form.facilityId,
      phone: form.phone.trim(),
      mustChangePassword: form.mustChangePassword,
      passwordExpiryDays: expiryToDays(form),
    };

    setSaving(true);
    try {
      if (mode === "new") {
        const res = await api<{ user: ManagedUser; temporaryPassword: string; emailSent: boolean; emailWarning?: string }>("/users", {
          method: "POST", body: JSON.stringify(payload),
        });
        // Surface the credential in a modal; navigating back happens on close.
        setCreated({ name: `${res.user.firstName} ${res.user.lastName}`, password: res.temporaryPassword, emailSent: res.emailSent, emailWarning: res.emailWarning });
      } else {
        await api(`/users/${initial!.id}`, { method: "PATCH", body: JSON.stringify(payload) });
        router.push("/users");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save user");
      setSaving(false);
    }
  };

  return (
    <>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>First name *</Label>
              <Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: sanitizePersonName(e.target.value) })} />
            </div>
            <div>
              <Label>Last name *</Label>
              <Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: sanitizePersonName(e.target.value) })} />
            </div>
            <div>
              <Label>Login ID (Email) *</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email address" />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={form.phone} inputMode="tel" onChange={(e) => setForm({ ...form, phone: sanitizePhone(e.target.value) })} placeholder="Phone number" />
            </div>
            <div>
              <Label>Role *</Label>
              <select
                className="h-11 w-full rounded-lg border bg-white px-3 text-sm"
                value={form.roleId}
                onChange={(e) => setForm({ ...form, roleId: e.target.value })}
              >
                <option value="">Select role</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Facility Access *</Label>
              <select
                className="h-11 w-full rounded-lg border bg-white px-3 text-sm"
                value={form.facilityAccess}
                onChange={(e) => {
                  const val = e.target.value as "assigned" | "all";
                  setForm({ ...form, facilityAccess: val, facilityId: val === "all" ? "" : form.facilityId });
                }}
              >
                <option value="assigned">Assigned Facility</option>
                <option value="all">All Facilities</option>
              </select>
            </div>
            {!spansAll && (
              <div className="md:col-span-2">
                <Label>Assigned Facility *</Label>
                <select
                  className="h-11 w-full rounded-lg border bg-white px-3 text-sm"
                  value={form.facilityId}
                  onChange={(e) => setForm({ ...form, facilityId: e.target.value })}
                >
                  <option value="">Select location</option>
                  {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <Label>Password expiry</Label>
              <div className="flex gap-2">
                <select
                  className="h-11 w-full rounded-lg border bg-white px-3 text-sm"
                  value={form.expiryPreset}
                  onChange={(e) => setForm({ ...form, expiryPreset: e.target.value })}
                >
                  {EXPIRY_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
                {form.expiryPreset === "custom" && (
                  <Input
                    className="w-28"
                    inputMode="numeric"
                    placeholder="days"
                    value={form.customExpiry}
                    onChange={(e) => setForm({ ...form, customExpiry: e.target.value.replace(/\D/g, "") })}
                  />
                )}
              </div>
            </div>
            <div className="flex items-end">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-medflow-600"
                  checked={form.mustChangePassword}
                  onChange={(e) => setForm({ ...form, mustChangePassword: e.target.checked })}
                />
                Force password change at next login
              </label>
            </div>
            <div className="flex gap-2 md:col-span-2">
              <Button type="submit" disabled={saving}>
                {mode === "new" ? "Create User" : "Save Changes"}
              </Button>
              <Button type="button" variant="outline" onClick={() => router.push("/users")}>Cancel</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <PasswordResultDialog info={created} onClose={() => router.push("/users")} />
    </>
  );
}
