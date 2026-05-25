const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("scm_token") || localStorage.getItem("medflow_token");
}

export function setToken(token: string) {
  localStorage.setItem("scm_token", token);
  localStorage.removeItem("medflow_token");
}

export function clearAuth() {
  localStorage.removeItem("scm_token");
  localStorage.removeItem("scm_user");
  localStorage.removeItem("medflow_token");
  localStorage.removeItem("medflow_user");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function api<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: HeadersInit = {
    ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
    ...(options.headers || {}),
  };
  if (token) (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (res.status === 401) {
    clearAuth();
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || data.message || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}
