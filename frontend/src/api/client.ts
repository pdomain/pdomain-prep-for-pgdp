/**
 * Thin fetch wrapper used by every page. The OpenAPI-generated types live in
 * ./types.ts (regenerated via `make openapi-export` whenever the FastAPI
 * Pydantic models change).
 */

// Use `globalThis` rather than `window` so this module can be imported
// in Node/jsdom test environments where `window` is not available at
// module-load time. At runtime in the browser, `globalThis === window`.
const API_BASE: string = (globalThis as any).__ENV__?.API_BASE ?? "";
const TOKEN_STORAGE_KEY = "pgdp.api_token";

/** Token resolution order: explicit storage (JWT login flow), then env (apikey mode). */
export function getAuthToken(): string | null {
  try {
    const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (stored) return stored;
  } catch {
    /* private mode / SSR */
  }
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

  const res = await fetch(url, { ...opts, method, headers, body });
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
