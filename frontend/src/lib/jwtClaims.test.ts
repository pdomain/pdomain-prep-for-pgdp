/**
 * Vitest coverage for the JWT claims helper used by `AuthBadge` and the
 * forthcoming profile dropdown (roadmap P2 #11). The helper is stdlib-only
 * (`atob` + `JSON.parse`) and never *verifies* the signature — verification
 * is the backend's job. Its only contract is "give me the unverified
 * payload claims, or `null` if the token is malformed".
 *
 * The cases below exercise:
 *  - happy path: a well-formed token returns the parsed claims
 *  - sub-only convenience: `decodeJwtSub` returns the `sub` claim or `null`
 *  - email convenience: `decodeJwtEmail` returns the `email` claim or `null`
 *  - exp convenience: `decodeJwtExp` returns the `exp` claim (seconds since
 *    epoch) as a `number`, or `null` if absent / non-numeric
 *  - malformed inputs: empty string, single-segment "header" only,
 *    non-base64 payload, base64 that decodes to non-JSON,
 *    base64-url alphabet (`-` / `_`) handled correctly
 *  - non-string `sub` / `email` claims fall through to `null` rather than
 *    leaking a number/object up to the UI
 */
import { describe, expect, it } from "vitest";
import {
  decodeJwtClaims,
  decodeJwtEmail,
  decodeJwtExp,
  decodeJwtSub,
} from "./jwtClaims";

/** Build a synthetic JWT with the given claims object. Header + signature
 * are placeholders — the helper never inspects them. */
function makeToken(claims: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const payload = btoa(JSON.stringify(claims))
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${header}.${payload}.signature-placeholder`;
}

describe("decodeJwtClaims", () => {
  it("returns the parsed claims for a well-formed token", () => {
    const t = makeToken({
      sub: "alice",
      email: "a@example.com",
      exp: 1717_000_000,
    });
    expect(decodeJwtClaims(t)).toEqual({
      sub: "alice",
      email: "a@example.com",
      exp: 1717_000_000,
    });
  });

  it("handles base64-url payloads with `-` and `_` characters", () => {
    // Pick a claim that produces `+` / `/` in standard base64 so the
    // url-safe replacements actually exercise.
    const t = makeToken({ sub: "subject?with?punctuation>>>" });
    const claims = decodeJwtClaims(t);
    expect(claims).not.toBeNull();
    expect((claims as Record<string, unknown>)["sub"]).toBe(
      "subject?with?punctuation>>>",
    );
  });

  it.each([
    ["empty string", ""],
    ["single segment", "header-only"],
    ["non-base64 payload", "header.@@not-base64@@.sig"],
    ["base64 of non-JSON", `header.${btoa("not json at all")}.sig`],
  ])("returns null for malformed token (%s)", (_label, token) => {
    expect(decodeJwtClaims(token)).toBeNull();
  });
});

describe("decodeJwtSub", () => {
  it("returns the sub claim when present and a string", () => {
    expect(decodeJwtSub(makeToken({ sub: "user-123" }))).toBe("user-123");
  });

  it("returns null when sub is missing", () => {
    expect(decodeJwtSub(makeToken({ email: "a@b.test" }))).toBeNull();
  });

  it("returns null when sub is not a string", () => {
    // Numeric `sub` is permitted by some IdPs; we only surface strings to
    // the UI to avoid `String(undefined)` style accidents downstream.
    expect(decodeJwtSub(makeToken({ sub: 42 }))).toBeNull();
  });

  it("returns null for a malformed token", () => {
    expect(decodeJwtSub("not.a.token")).toBeNull();
  });
});

describe("decodeJwtEmail", () => {
  it("returns the email claim when present and a string", () => {
    expect(decodeJwtEmail(makeToken({ email: "alice@example.com" }))).toBe(
      "alice@example.com",
    );
  });

  it("returns null when email is missing", () => {
    expect(decodeJwtEmail(makeToken({ sub: "alice" }))).toBeNull();
  });

  it("returns null when email is not a string", () => {
    expect(decodeJwtEmail(makeToken({ email: 12345 }))).toBeNull();
  });
});

describe("decodeJwtExp", () => {
  it("returns the exp claim as a number when present", () => {
    expect(decodeJwtExp(makeToken({ exp: 1_717_000_000 }))).toBe(1_717_000_000);
  });

  it("returns null when exp is missing", () => {
    expect(decodeJwtExp(makeToken({ sub: "alice" }))).toBeNull();
  });

  it("returns null when exp is not a number", () => {
    // Spec-wise `exp` is "NumericDate" — a JSON number. A string-encoded
    // expiry is malformed; rather than coerce we surface null so callers
    // can render a "no expiry info" fallback.
    expect(decodeJwtExp(makeToken({ exp: "1717000000" }))).toBeNull();
  });
});
