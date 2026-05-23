/**
 * Thin fetch wrapper used by every page. The OpenAPI-generated types live in
 * ./types.ts (regenerated via `make openapi-export` whenever the FastAPI
 * Pydantic models change).
 */

// Use `globalThis` rather than `window` so this module can be imported
// in Node/jsdom test environments where `window` is not available at
// module-load time. At runtime in the browser, `globalThis === window`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- __ENV__ is an untyped runtime injection from env.js
const API_BASE: string = (globalThis as any).__ENV__?.API_BASE ?? "";
const TOKEN_STORAGE_KEY = "pgdp.api_token";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- __ENV__ is an untyped runtime injection from env.js
const AUTH_MODE: string = (globalThis as any).__ENV__?.AUTH_MODE ?? "none";

/** Token resolution: only used in jwt mode (apikey mode uses httpOnly cookie). */
export function getAuthToken(): string | null {
  if (AUTH_MODE === "apikey") {
    // In apikey mode, authentication is carried by the httpOnly session cookie
    // (issued by POST /api/auth/session). The bearer is never exposed to JS.
    return null;
  }
  try {
    const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (stored) return stored;
  } catch {
    /* private mode / SSR */
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- __ENV__ is an untyped runtime injection from env.js
  return (globalThis as any).__ENV__?.API_TOKEN ?? null;
}

export function setAuthToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Log in with the shared API key (apikey mode only).
 *
 * POSTs the key to /api/auth/session. On success, the server sets an httpOnly
 * SameSite=Strict cookie — no JS-readable secret is involved. Subsequent API
 * calls automatically carry the cookie via `credentials: "include"`.
 */
export async function loginWithApiKey(apiKey: string): Promise<void> {
  const url = `${API_BASE}/api/auth/session`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey }),
    credentials: "include",
  });
  if (!res.ok) {
    throw Object.assign(new Error(`Login failed: HTTP ${res.status}`), {
      status: res.status,
    });
  }
}

/**
 * Log out (apikey and jwt modes).
 *
 * Clears the session cookie server-side and removes any stored JWT token.
 */
export async function logout(): Promise<void> {
  // Clear server-side session cookie (apikey mode).
  try {
    await fetch(`${API_BASE}/api/auth/session/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch {
    /* ignore network errors during logout */
  }
  // Clear any stored JWT token (jwt mode).
  setAuthToken(null);
}

type FetchOpts = Omit<RequestInit, "body"> & {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
};

async function request<T>(
  method: string,
  path: string,
  opts: FetchOpts = {},
): Promise<T> {
  let url = `${API_BASE}${path}`;
  if (opts.query) {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) {
      if (v === undefined || v === null) continue;
      search.set(k, String(v));
    }
    const qs = search.toString();
    if (qs) url += `?${qs}`;
  }

  const headers = new Headers(opts.headers ?? {});
  let body: BodyInit | null = null;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers.set("Content-Type", "application/json");
  }
  const token = getAuthToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(url, {
    ...opts,
    method,
    headers,
    body,
    // credentials: "include" ensures the httpOnly session cookie is sent for
    // apikey mode. It is harmless for none/jwt modes.
    credentials: "include",
  });
  if (!res.ok) {
    let detail: unknown = await res.text();
    try {
      detail = JSON.parse(detail as string);
    } catch {
      /* leave as text */
    }
    throw Object.assign(new Error(`HTTP ${res.status}`), {
      status: res.status,
      detail,
    });
  }
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, opts?: FetchOpts) => request<T>("GET", path, opts),
  post: <T>(path: string, body?: unknown, opts?: FetchOpts) =>
    request<T>("POST", path, { ...opts, body }),
  put: <T>(path: string, body?: unknown, opts?: FetchOpts) =>
    request<T>("PUT", path, { ...opts, body }),
  patch: <T>(path: string, body?: unknown, opts?: FetchOpts) =>
    request<T>("PATCH", path, { ...opts, body }),
  delete: <T>(path: string, opts?: FetchOpts) =>
    request<T>("DELETE", path, opts),
};
