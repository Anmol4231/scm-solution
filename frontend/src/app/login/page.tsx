"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Eye, EyeOff, Lock } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type MessageType = "warning" | "locked" | "error" | null;

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<MessageType>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { setMessageType("error"); setMessage("Please enter your email address."); return; }
    if (!password) { setMessageType("error"); setMessage("Please enter your password."); return; }
    setLoading(true);
    setMessage("");
    setMessageType(null);
    try {
      await login(email, password);
      router.push("/dashboard");
    } catch (err) {
      const text = err instanceof Error ? err.message : "Login failed";
      if (text.toLowerCase().includes("locked") && text.toLowerCase().includes("minute")) {
        setMessageType("locked");
      } else if (text.toLowerCase().includes("attempt") && text.toLowerCase().includes("left")) {
        setMessageType("warning");
      } else {
        setMessageType("error");
      }
      setMessage(text);
    } finally {
      setLoading(false);
    }
  };

  const isLocked = messageType === "locked";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-slate-100 via-slate-50 to-medflow-50 p-4">
      {/* Logo / Brand */}
      <img
        src="/icons/StockTrackRx.jpeg"
        alt="StockTrackRx"
        className="mb-8 h-auto w-full max-w-[400px]"
      />

      <div className="w-full max-w-sm">
        {/* Card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
          <h2 className="mb-5 text-base font-semibold text-slate-700">Sign in to your account</h2>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Email */}
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-medium text-slate-700">
                Email address
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (messageType === "error") { setMessage(""); setMessageType(null); } }}
                autoComplete="username"
                placeholder="Email address"
                disabled={isLocked}
                className="h-10"
              />
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-sm font-medium text-slate-700">
                  Password
                </Label>
                <a
                  href="/forgot-password"
                  className="text-sm font-medium text-medflow-600 hover:text-medflow-700 hover:underline"
                  tabIndex={0}
                >
                  Forgot password?
                </a>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); if (messageType === "error") { setMessage(""); setMessageType(null); } }}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  disabled={isLocked}
                  className="h-10 pr-10"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Messages */}
            {messageType === "warning" && (
              <div className="flex gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <p className="text-sm text-amber-800">{message}</p>
              </div>
            )}

            {messageType === "locked" && (
              <div className="flex gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                <p className="text-sm text-red-800">{message}</p>
              </div>
            )}

            {messageType === "error" && (
              <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2.5">
                <p className="text-sm text-red-700">{message}</p>
              </div>
            )}

            {/* Submit */}
            <Button
              type="submit"
              size="lg"
              className="mt-1 h-10 w-full text-sm font-semibold"
              disabled={loading || isLocked}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Signing in…
                </span>
              ) : (
                "Sign In"
              )}
            </Button>
          </form>
        </div>

        <p className="mt-5 text-center text-sm text-slate-400">
          Contact your system administrator if you need access.
        </p>
      </div>
    </div>
  );
}
