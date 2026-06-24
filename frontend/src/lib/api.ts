const CONFIGURED_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
const API_PORT = process.env.NEXT_PUBLIC_API_PORT || "4000";

function isLocalhost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function normalizeApiUrl(url: string) {
  return url.replace(/\/+$/, "");
}

function resolveApiUrl(): string {
  if (typeof window === "undefined") return normalizeApiUrl(CONFIGURED_API_URL);

  const configured = new URL(CONFIGURED_API_URL, window.location.origin);
  const pageHost = window.location.hostname;

  if (isLocalhost(configured.hostname) && !isLocalhost(pageHost)) {
    configured.hostname = pageHost;
    configured.port = API_PORT;
    configured.protocol = window.location.protocol === "https:" ? "https:" : "http:";
  }

  return normalizeApiUrl(configured.toString());
}

const API_URL = normalizeApiUrl(CONFIGURED_API_URL);

export { API_URL, resolveApiUrl };

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

function cacheKey(path: string, method: string) {
  return `${method}:${path}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const isBrowser = typeof window !== "undefined";
  const online = !isBrowser || navigator.onLine;

  if (isBrowser && !online) {
    const {
      getCached,
      enqueueSync,
      cacheResponse,
      isServerOnlyPath,
      offlineBlockedMessage,
      entityTypeFromPath,
      labelFromPath,
    } = await import("./offline/sync-engine");

    if (isServerOnlyPath(path, method)) {
      throw new Error(offlineBlockedMessage(path));
    }

    if (method === "GET") {
      const cached = await getCached<T>(cacheKey(path, method));
      if (cached !== null) return cached;
      throw new Error("No cached data for this view. Connect to load latest data.");
    }

    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      const body = typeof options.body === "string" ? options.body : "";
      await enqueueSync({
        method,
        path,
        body,
        entityType: entityTypeFromPath(path, method),
        label: labelFromPath(path, method),
      });
      const optimistic = {
        ok: true,
        offline: true,
        message: "Saved locally. Will sync when online.",
        queued: true,
      };
      await cacheResponse(cacheKey(path, method), optimistic);
      window.dispatchEvent(new CustomEvent("scm-sync-queue-updated"));
      return optimistic as T;
    }
  }

  const token = getToken();
  const headers: HeadersInit = {
    ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
    ...(options.headers || {}),
  };
  if (token) (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;

  try {
    const res = await fetch(`${resolveApiUrl()}${path}`, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      if (path !== "/auth/login") {
        clearAuth();
        if (typeof window !== "undefined") window.location.href = "/login";
      }
      throw new Error(data.error || data.message || "Unauthorized");
    }
    if (!res.ok) {
      const msg = data.error || data.message || `Request failed (${res.status})`;
      throw new Error(msg);
    }

    if (isBrowser && method === "GET") {
      import("./offline/sync-engine")
        .then(({ cacheResponse }) => cacheResponse(cacheKey(path, method), data))
        .catch(() => {});
    }

    return data as T;
  } catch (err) {
    if (isBrowser && method === "GET") {
      try {
        const { getCached } = await import("./offline/sync-engine");
        const cached = await Promise.race([
          getCached<T>(cacheKey(path, method)),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
        ]);
        if (cached !== null) return cached;
      } catch {
        // ignore cache errors, fall through to throw
      }
    }
    throw err;
  }
}
