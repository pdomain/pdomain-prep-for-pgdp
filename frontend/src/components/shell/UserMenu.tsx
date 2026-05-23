/**
 * UserMenu — consolidated auth + theme dropdown (hifi P1-2).
 *
 * Replaces the ProfileDropdown + AuthBadge split in App.tsx.
 * Uses the Radix-backed DropdownMenu wrapper. Handles all three auth modes:
 *   - "none"   → renders nothing
 *   - "apikey" → shows user_id badge, no sign-out
 *   - "jwt"    → shows user_id, expiry, and sign-out action
 *
 * Theme submenu writes to uiPrefs store (Light / Dark / System).
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { User } from "@/icons/local-shims";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { Button } from "@/components/ui/Button";
import { useUiPrefs } from "@/stores/uiPrefs";
import { api, getAuthToken, logout, setAuthToken } from "@/api/client";

interface UserMenuProps {
  "data-testid"?: string;
}

export function UserMenu({ "data-testid": testId }: UserMenuProps) {
  const { theme, setTheme } = useUiPrefs();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- __ENV__ is an untyped runtime injection from env.js
  const env = (window as any).__ENV__ ?? {};
  const authMode: string = env.AUTH_MODE ?? "none";

  // Track JWT token changes (login / logout storage events).
  const [token, setToken] = useState<string | null>(getAuthToken());

  useEffect(() => {
    const handler = () => setToken(getAuthToken());
    window.addEventListener("storage", handler);
    window.addEventListener("focus", handler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener("focus", handler);
    };
  }, []);

  // Fetch /api/auth/me for identity in apikey + jwt modes.
  const me = useQuery({
    queryKey: ["me", token],
    queryFn: () => api.get<{ user_id: string }>("/api/auth/me"),
    retry: false,
    enabled: authMode !== "none",
  });

  const userId = me.data?.user_id ?? null;

  function handleSignOut() {
    // logout() clears the httpOnly session cookie (apikey mode) and any
    // stored JWT token (jwt mode). setAuthToken(null) is also called inside
    // logout(), but we keep setToken(null) here to trigger immediate re-render.
    void logout().finally(() => {
      setAuthToken(null);
      setToken(null);
      queryClient.clear();
      void navigate("/login");
    });
  }

  // "none" mode: nothing to show.
  if (authMode === "none") return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          data-testid={testId ?? "user-menu-trigger"}
          className="text-white hover:bg-slate-700"
          aria-label="User menu"
        >
          <User className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        {/* Account section */}
        <DropdownMenuLabel>Account</DropdownMenuLabel>
        <DropdownMenuItem disabled>
          <span className="font-mono text-xs text-ink-3">{userId ?? "—"}</span>
        </DropdownMenuItem>

        {/* apikey badge */}
        {authMode === "apikey" && (
          <DropdownMenuItem disabled>
            <span className="rounded bg-bg-raised px-2 py-0.5 text-xs text-ink-3">
              apikey mode
            </span>
          </DropdownMenuItem>
        )}

        {/* JWT sign-out */}
        {authMode === "jwt" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut}>
              Sign out
            </DropdownMenuItem>
          </>
        )}

        <DropdownMenuSeparator />

        {/* Theme submenu */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Theme: {theme}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onClick={() => setTheme("light")}>
              Light {theme === "light" && "✓"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("dark")}>
              Dark {theme === "dark" && "✓"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("system")}>
              System {theme === "system" && "✓"}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
