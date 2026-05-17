/**
 * OIDC PKCE login flow for managed (JWT) mode.
 *
 * The page acts as both the launcher and the OAuth redirect target:
 *   - On first mount, if there's no `?code=` query param, generate a PKCE
 *     verifier/challenge, stash the verifier in sessionStorage, and redirect
 *     to `${JWT_ISSUER}/authorize?...`.
 *   - On the redirect callback, exchange the code for a token at
 *     `${JWT_ISSUER}/token`, store the access token via `setAuthToken`,
 *     navigate back to `/`.
 *
 * Self-hosted apikey mode never reaches this page — `api/client.ts` already
 * pulls the token from `__ENV__.API_TOKEN`.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { setAuthToken } from "../api/client";
import { Card } from "../components/ui/Card";

const PKCE_VERIFIER_KEY = "pgdp.pkce_verifier";
const PKCE_RETURN_TO_KEY = "pgdp.return_to";

interface EnvShape {
  AUTH_MODE?: string;
  JWT_ISSUER?: string;
  JWT_AUDIENCE?: string;
}

function env(): EnvShape {
  return ((window as any).__ENV__ ?? {}) as EnvShape;
}

export function LoginPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const e = env();
    if (e.AUTH_MODE !== "jwt" || !e.JWT_ISSUER) {
      setError(
        "Login is only used in JWT auth mode. Check window.__ENV__ / /env.js.",
      );
      return;
    }

    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (code) {
      // Step 2: exchange code for token.
      const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
      const stateOk = state === sessionStorage.getItem("pgdp.pkce_state");
      if (!verifier || !stateOk) {
        setError("PKCE state mismatch — restart the login flow.");
        return;
      }
      void exchangeCode(e.JWT_ISSUER, code, verifier)
        .then((token) => {
          setAuthToken(token);
          sessionStorage.removeItem(PKCE_VERIFIER_KEY);
          const ret = sessionStorage.getItem(PKCE_RETURN_TO_KEY) ?? "/";
          sessionStorage.removeItem(PKCE_RETURN_TO_KEY);
          void navigate(ret, { replace: true });
        })
        .catch((err: unknown) =>
          setError(err instanceof Error ? err.message : String(err)),
        );
      return;
    }

    // Step 1: kick off the PKCE flow.
    void startPkce(e).catch((err: unknown) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  }, [navigate]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="w-full max-w-md space-y-4 p-8 text-center">
        {/* Brand glyph — matches TopNav left cluster */}
        <div className="flex justify-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 text-base font-bold text-slate-900">
            p
          </span>
        </div>
        <h1 className="text-lg font-semibold text-ink-1">Sign in</h1>
        {error ? (
          <p className="text-sm text-status-error">{error}</p>
        ) : (
          <p className="text-sm text-ink-3">
            Redirecting to your identity provider…
          </p>
        )}
      </Card>
    </div>
  );
}

// ─── PKCE helpers ───────────────────────────────────────────────────────────

async function startPkce(e: EnvShape): Promise<void> {
  const verifier = generateVerifier();
  const challenge = await s256Challenge(verifier);
  const state = generateVerifier(16);
  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  sessionStorage.setItem("pgdp.pkce_state", state);
  sessionStorage.setItem(PKCE_RETURN_TO_KEY, window.location.pathname);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: "pgdp-prep",
    redirect_uri: window.location.origin + "/login",
    scope: "openid profile",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  if (e.JWT_AUDIENCE) params.set("audience", e.JWT_AUDIENCE);
  window.location.href = `${e.JWT_ISSUER}/authorize?${params.toString()}`;
}

async function exchangeCode(
  issuer: string,
  code: string,
  verifier: string,
): Promise<string> {
  const r = await fetch(`${issuer}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: "pgdp-prep",
      code,
      redirect_uri: window.location.origin + "/login",
      code_verifier: verifier,
    }),
  });
  if (!r.ok) throw new Error(`token exchange failed: HTTP ${r.status}`);
  const data = await r.json();
  if (!data.access_token)
    throw new Error("token response missing access_token");
  return data.access_token as string;
}

function generateVerifier(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64url(buf);
}

async function s256Challenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64url(new Uint8Array(digest));
}

function base64url(buf: Uint8Array): string {
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
