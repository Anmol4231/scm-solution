"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { MessageCircle, X, Send, Stethoscope, User } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

interface ChatMessagePayload {
  sender: string;
  message: string;
  timestamp: string;
  avatar: string;
  role: "user" | "assistant";
}

interface AssistantProfile {
  name: string;
  subtitle: string;
  avatar: string;
}

const QUICK_ACTIONS = [
  { label: "Low Stock", message: "Which medicines are low stock?" },
  { label: "Expiry", message: "Show medicines expiring in 30 days" },
  { label: "Dispensing", message: "Today's dispensing summary" },
  { label: "Transfers", message: "Pending transfers" },
  { label: "Orders", message: "Show recent orders" },
  { label: "Reports", message: "Show daily report" },
  { label: "Recent Activity", message: "Show recent patients and dispensing" },
  { label: "Inventory Summary", message: "Current inventory summary" },
];

const DEFAULT_ASSISTANT: AssistantProfile = {
  name: "StockTrackRx Assistant",
  subtitle: "Healthcare Inventory & Workflow Assistant",
  avatar: "healthcare-assistant",
};

const WELCOME_FALLBACK =
  "Hello 👋 I'm StockTrackRx Assistant. I can help with inventory, stock levels, expiry alerts, patients, reports, transfers, and workflow guidance.";

function safeText(value: unknown, fallback: string): string {
  if (value === null || value === undefined) return fallback;
  const s = String(value).trim();
  if (!s || s === "unknown" || s === "undefined" || s === "null") return fallback;
  return s;
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function Avatar({ role }: { role: "user" | "assistant" }) {
  if (role === "user") {
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600">
        <User className="h-4 w-4" />
      </div>
    );
  }
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-medflow-500 to-medflow-700 text-white shadow-sm">
      <Stethoscope className="h-4 w-4" />
    </div>
  );
}

export function ScmAssistant() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [assistant, setAssistant] = useState<AssistantProfile>(DEFAULT_ASSISTANT);
  const [messages, setMessages] = useState<ChatMessagePayload[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadProfile = useCallback(async () => {
    try {
      const data = await api<{
        assistant: AssistantProfile;
        welcome: ChatMessagePayload[];
      }>("/chat/profile");
      setAssistant({
        name: safeText(data.assistant?.name, DEFAULT_ASSISTANT.name),
        subtitle: safeText(data.assistant?.subtitle, DEFAULT_ASSISTANT.subtitle),
        avatar: safeText(data.assistant?.avatar, DEFAULT_ASSISTANT.avatar),
      });
      if (data.welcome?.length) {
        setMessages(
          data.welcome.map((m) => ({
            sender: safeText(m.sender, DEFAULT_ASSISTANT.name),
            message: safeText(m.message, WELCOME_FALLBACK),
            timestamp: m.timestamp || new Date().toISOString(),
            avatar: safeText(m.avatar, DEFAULT_ASSISTANT.avatar),
            role: m.role === "user" ? "user" : "assistant",
          }))
        );
      } else {
        setMessages([
          {
            sender: DEFAULT_ASSISTANT.name,
            message: WELCOME_FALLBACK,
            timestamp: new Date().toISOString(),
            avatar: DEFAULT_ASSISTANT.avatar,
            role: "assistant",
          },
        ]);
      }
    } catch {
      setMessages([
        {
          sender: DEFAULT_ASSISTANT.name,
          message: WELCOME_FALLBACK,
          timestamp: new Date().toISOString(),
          avatar: DEFAULT_ASSISTANT.avatar,
          role: "assistant",
        },
      ]);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open, loading]);

  async function send(text: string) {
    if (!text.trim() || loading) return;
    const userMsg = text.trim();
    setInput("");
    const userPayload: ChatMessagePayload = {
      sender: user ? `${user.firstName} ${user.lastName}`.trim() || "You" : "You",
      message: userMsg,
      timestamp: new Date().toISOString(),
      avatar: "user",
      role: "user",
    };
    setMessages((m) => [...m, userPayload]);
    setLoading(true);
    try {
      const res = await api<{
        reply: string;
        assistant?: AssistantProfile;
        messages?: ChatMessagePayload[];
      }>("/chat", {
        method: "POST",
        body: JSON.stringify({
          message: userMsg,
          facilityId: user?.facilityId ?? undefined,
        }),
      });

      if (res.assistant) {
        setAssistant({
          name: safeText(res.assistant.name, DEFAULT_ASSISTANT.name),
          subtitle: safeText(res.assistant.subtitle, DEFAULT_ASSISTANT.subtitle),
          avatar: safeText(res.assistant.avatar, DEFAULT_ASSISTANT.avatar),
        });
      }

      const assistantMsgs = res.messages?.filter((m) => m.role === "assistant") ?? [];
      const replyText = safeText(
        assistantMsgs[assistantMsgs.length - 1]?.message ?? res.reply,
        "I'm here to help with inventory and workflows. Please try again."
      );

      setMessages((m) => [
        ...m,
        {
          sender: safeText(assistantMsgs[0]?.sender, DEFAULT_ASSISTANT.name),
          message: replyText.replace(/\*\*/g, ""),
          timestamp: assistantMsgs[0]?.timestamp || new Date().toISOString(),
          avatar: safeText(assistantMsgs[0]?.avatar, DEFAULT_ASSISTANT.avatar),
          role: "assistant",
        },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          sender: DEFAULT_ASSISTANT.name,
          message: "Sorry, I could not process that request. Please try again.",
          timestamp: new Date().toISOString(),
          avatar: DEFAULT_ASSISTANT.avatar,
          role: "assistant",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-medflow-600 px-5 py-3 text-sm font-semibold text-white shadow-lg transition-all duration-300 hover:bg-medflow-700 hover:shadow-xl",
          "max-sm:bottom-20 max-sm:right-4 max-sm:px-4",
          open && "pointer-events-none scale-95 opacity-0"
        )}
        aria-label="Chat with Us"
      >
        <MessageCircle className="h-5 w-5" />
        Chat with Us
      </button>

      <div
        className={cn(
          "fixed z-50 flex flex-col overflow-hidden border border-slate-200/90 bg-white shadow-2xl transition-all duration-300",
          "inset-x-2 bottom-2 top-2 rounded-xl sm:inset-auto sm:bottom-6 sm:right-6 sm:h-[min(560px,88vh)] sm:w-[min(420px,calc(100vw-1.5rem))] sm:rounded-2xl",
          open ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"
        )}
        aria-hidden={!open}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-white/20 bg-gradient-to-r from-medflow-600 via-medflow-600 to-sky-600 px-4 py-3.5 text-white">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar role="assistant" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight">{assistant.name}</p>
              <p className="truncate text-[11px] leading-snug text-white/85">{assistant.subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg p-1.5 transition hover:bg-white/15"
            aria-label="Close chat"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-slate-100 bg-slate-50/90 px-3 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {QUICK_ACTIONS.map((a) => (
            <button
              key={a.label}
              type="button"
              className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm transition hover:border-medflow-300 hover:text-medflow-700"
              onClick={() => send(a.message)}
            >
              {a.label}
            </button>
          ))}
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto bg-gradient-to-b from-slate-50/50 to-white px-3 py-3 sm:px-4 sm:py-4">
          {messages.map((msg, i) => (
            <div
              key={`${msg.timestamp}-${i}`}
              className={cn("flex min-w-0 gap-2.5", msg.role === "user" ? "flex-row-reverse" : "flex-row")}
            >
              <Avatar role={msg.role} />
              <div className={cn("max-w-[82%] min-w-0 sm:max-w-[78%]", msg.role === "user" ? "items-end" : "items-start")}>
                <p
                  className={cn(
                    "mb-1 text-[10px] font-medium",
                    msg.role === "user" ? "text-right text-slate-500" : "text-slate-600"
                  )}
                >
                  {safeText(msg.sender, msg.role === "user" ? "You" : DEFAULT_ASSISTANT.name)}
                </p>
                <div
                  className={cn(
                    "overflow-hidden rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed shadow-sm",
                    msg.role === "user"
                      ? "rounded-tr-md bg-medflow-600 text-white"
                      : "rounded-tl-md border border-slate-100 bg-white text-slate-800"
                  )}
                >
                  <span className="whitespace-pre-wrap break-words">{safeText(msg.message, "")}</span>
                </div>
                <p
                  className={cn(
                    "mt-1 text-[10px] text-slate-400",
                    msg.role === "user" ? "text-right" : "text-left"
                  )}
                >
                  {formatTime(msg.timestamp)}
                </p>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex gap-2.5">
              <Avatar role="assistant" />
              <div className="rounded-2xl rounded-tl-md border border-slate-100 bg-white px-4 py-3 shadow-sm">
                <div className="flex gap-1">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-medflow-400 [animation-delay:0ms]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-medflow-400 [animation-delay:150ms]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-medflow-400 [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <form
          className="flex shrink-0 gap-2 border-t border-slate-100 bg-white p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <input
            className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm transition focus:border-medflow-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-medflow-100"
            placeholder="Ask about stock, expiry, patients…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <Button type="submit" size="icon" disabled={loading} className="h-11 w-11 shrink-0 rounded-xl">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </>
  );
}
