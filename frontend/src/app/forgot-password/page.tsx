"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<{
    resetUrl?: string;
    resetToken?: string;
    simulatedEmail?: { subject: string; body: string };
  } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await api<typeof result & { message: string }>("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-medflow-50 to-white p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl text-medflow-700">SCM Solution</CardTitle>
          <p className="text-sm text-muted-foreground">Reset your password</p>
        </CardHeader>
        <CardContent>
          {!result ? (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label htmlFor="email">Email address</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" size="lg" className="w-full" disabled={loading}>
                {loading ? "Sending..." : "Send Reset Link"}
              </Button>
              <p className="text-center text-sm">
                <Link href="/login" className="text-medflow-600 hover:underline">Back to login</Link>
              </p>
            </form>
          ) : (
            <div className="space-y-3 rounded-lg bg-green-50 p-4 text-sm">
              <p className="font-medium text-green-800">Reset link generated (simulated email)</p>
              {result.simulatedEmail && (
                <div className="rounded border bg-white p-3 text-xs">
                  <p className="font-semibold">{result.simulatedEmail.subject}</p>
                  <p className="mt-1 text-muted-foreground">{result.simulatedEmail.body}</p>
                </div>
              )}
              {result.resetToken && (
                <Link
                  href={`/reset-password?token=${result.resetToken}`}
                  className="block text-center font-medium text-medflow-600 hover:underline"
                >
                  Continue to reset password →
                </Link>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
