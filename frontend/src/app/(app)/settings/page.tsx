"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { simpleRoleLabel } from "@/lib/roles";
import { sanitizeNameInput } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
  const { user, refreshUser } = useAuth();

  const [profile, setProfile] = useState({ firstName: "", lastName: "", phone: "" });
  const [profileMsg, setProfileMsg] = useState("");
  const [profileErr, setProfileErr] = useState("");

  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [pwMsg, setPwMsg] = useState("");
  const [pwErr, setPwErr] = useState("");

  useEffect(() => {
    if (user) setProfile({ firstName: user.firstName, lastName: user.lastName, phone: "" });
  }, [user]);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMsg(""); setProfileErr("");
    try {
      await api("/auth/profile", {
        method: "PATCH",
        body: JSON.stringify({ firstName: profile.firstName.trim(), lastName: profile.lastName.trim(), phone: profile.phone.trim() || undefined }),
      });
      await refreshUser();
      setProfileMsg("Profile updated");
    } catch (err) {
      setProfileErr(err instanceof Error ? err.message : "Failed to update profile");
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMsg(""); setPwErr("");
    if (pw.newPassword.length < 6) return setPwErr("New password must be at least 6 characters");
    if (pw.newPassword !== pw.confirm) return setPwErr("New passwords do not match");
    try {
      await api("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: pw.currentPassword, newPassword: pw.newPassword }),
      });
      await refreshUser();
      setPw({ currentPassword: "", newPassword: "", confirm: "" });
      setPwMsg("Password changed successfully");
    } catch (err) {
      setPwErr(err instanceof Error ? err.message : "Failed to change password");
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">User Settings</h1>
      </div>

      {/* Profile */}
      <Card>
        <CardHeader><CardTitle className="text-base">Profile</CardTitle></CardHeader>
        <CardContent>
          {profileErr && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{profileErr}</p>}
          {profileMsg && <p className="mb-3 rounded-lg bg-green-50 p-3 text-green-700">{profileMsg}</p>}
          <form onSubmit={saveProfile} className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>First name</Label>
              <Input value={profile.firstName} onChange={(e) => setProfile({ ...profile, firstName: sanitizeNameInput(e.target.value) })} required />
            </div>
            <div>
              <Label>Last name</Label>
              <Input value={profile.lastName} onChange={(e) => setProfile({ ...profile, lastName: sanitizeNameInput(e.target.value) })} required />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} placeholder="Optional" />
            </div>
            <div className="grid grid-cols-2 gap-3 md:col-span-2">
              <div>
                <Label>Username / Email</Label>
                <Input value={user?.email ?? ""} disabled />
              </div>
              <div>
                <Label>Role &amp; location</Label>
                <Input value={`${simpleRoleLabel(user?.role)}${user?.facility?.name ? ` · ${user.facility.name}` : ""}`} disabled />
              </div>
            </div>
            <div className="md:col-span-2">
              <Button type="submit">Save Profile</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Change password */}
      <Card>
        <CardHeader><CardTitle className="text-base">Change Password</CardTitle></CardHeader>
        <CardContent>
          {pwErr && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{pwErr}</p>}
          {pwMsg && <p className="mb-3 rounded-lg bg-green-50 p-3 text-green-700">{pwMsg}</p>}
          <form onSubmit={changePassword} className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <Label>Current password</Label>
              <Input type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required />
            </div>
            <div>
              <Label>New password</Label>
              <Input type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required />
            </div>
            <div>
              <Label>Confirm new password</Label>
              <Input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required />
            </div>
            <div className="md:col-span-2">
              <Button type="submit">Update Password</Button>
            </div>
          </form>
        </CardContent>
      </Card>

    </div>
  );
}
