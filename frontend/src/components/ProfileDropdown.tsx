/**
 * Profile menu for JWT auth mode (roadmap P2 #11).
 *
 * Replaces the inline `AuthBadge` JWT branch in `App.tsx`. Surfaces the
 * email/sub identity, the token expiry, and a Sign-out action. Stateless
 * about *how* sign-out happens — the parent passes `onSignOut`, which is
 * also responsible for clearing `localStorage` and react-query cache.
 *
 * No dropdown library: a button toggles `open`, and an outside-click
 * listener closes the menu. shadcn/ui Radix migration is tracked under
 * roadmap §13a; this component should swap to `<DropdownMenu>` then.
 */
import { useEffect, useRef, useState } from "react";
import { decodeJwtEmail, decodeJwtExp, decodeJwtSub } from "../lib/jwtClaims";

interface Props {
  token: string;
  onSignOut: () => void;
}

/** Format a NumericDate (seconds-since-epoch) as `YYYY-MM-DD HH:MM UTC`.
 * UTC keeps the rendering deterministic across CI runners and timezones. */
function formatExp(exp: number | null): string {
  if (exp === null) return "no expiry";
  const d = new Date(exp * 1000);
  if (Number.isNaN(d.getTime())) return "no expiry";
  const iso = d.toISOString(); // YYYY-MM-DDTHH:MM:SS.sssZ
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export function ProfileDropdown({ token, onSignOut }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const email = decodeJwtEmail(token);
  const sub = decodeJwtSub(token);
  const exp = decodeJwtExp(token);
  const label = email ?? sub ?? "user";

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const node = containerRef.current;
      if (node && !node.contains(e.target as Node)) setOpen(false);
    };
    // Defer one microtask so the click that opened the menu doesn't
    // immediately close it on the same event loop tick.
    const id = window.setTimeout(
      () => document.addEventListener("mousedown", handler),
      0,
    );
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", handler);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="ml-auto relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded bg-raised px-2 py-0.5 text-xs font-mono text-ink-2 hover:bg-sunk"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 w-64 rounded border border-border-1 bg-surface p-2 text-xs text-ink-2 shadow"
        >
          <div className="px-2 py-1">
            <div className="font-medium">{email ?? sub ?? "user"}</div>
            {email && sub && <div className="text-ink-3 font-mono">{sub}</div>}
            <div className="mt-1 text-ink-3">Expires: {formatExp(exp)}</div>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
            className="mt-1 w-full rounded px-2 py-1 text-left hover:bg-raised"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
