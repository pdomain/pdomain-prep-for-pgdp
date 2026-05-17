/**
 * Stdlib-only helpers for inspecting an unverified JWT payload.
 *
 * The SPA never *verifies* a token — that is the FastAPI auth adapter's
 * job. These helpers exist so the nav + future profile dropdown
 * (roadmap P2 #11) can surface the human-readable identity claims
 * (`sub`, `email`) and expiry (`exp`) without pulling in `jose` or any
 * other crypto dependency.
 *
 * Originally lived as `decodeJwtSub` inline in `App.tsx`; lifted here
 * to grow `email` + `exp` siblings under vitest coverage before the
 * dropdown UI lands.
 */

/** Parse a JWT and return its claims object, or `null` if malformed. */
export function decodeJwtClaims(token: string): Record<string, unknown> | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  const payload = parts[1];
  if (!payload) return null;
  try {
    // base64url -> base64 (RFC 7515 §2). atob doesn't accept the URL-safe
    // alphabet, so swap the two distinguishing characters.
    const standard = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(standard);
    const claims = JSON.parse(decoded);
    if (
      claims === null ||
      typeof claims !== "object" ||
      Array.isArray(claims)
    ) {
      return null;
    }
    return claims as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Convenience: return the `sub` claim if it's a string, else `null`. */
export function decodeJwtSub(token: string): string | null {
  const claims = decodeJwtClaims(token);
  if (!claims) return null;
  return typeof claims["sub"] === "string" ? claims["sub"] : null;
}

/** Convenience: return the `email` claim if it's a string, else `null`. */
export function decodeJwtEmail(token: string): string | null {
  const claims = decodeJwtClaims(token);
  if (!claims) return null;
  return typeof claims["email"] === "string" ? claims["email"] : null;
}

/** Convenience: return the `exp` claim (NumericDate, seconds-since-epoch)
 * if it's a finite number, else `null`. */
export function decodeJwtExp(token: string): number | null {
  const claims = decodeJwtClaims(token);
  if (!claims) return null;
  return typeof claims["exp"] === "number" && Number.isFinite(claims["exp"])
    ? claims["exp"]
    : null;
}
