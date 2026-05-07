/**
 * Tests for ProfileDropdown — the JWT-mode profile menu (roadmap P2 #11).
 *
 * The button label prefers the `email` claim, falling back to `sub`. Opening
 * the menu reveals the email (or sub if no email), the expiry as a
 * human-readable timestamp, and a Sign-out action that clears the token and
 * fires the supplied `onSignOut` callback.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileDropdown } from "./ProfileDropdown";

/** Build a JWT with the given payload. Header + signature are placeholders;
 * the SPA never verifies — `decodeJwtClaims` only reads payload. */
function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${header}.${body}.sig`;
}

describe("ProfileDropdown", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders email when the JWT carries one", () => {
    const token = makeJwt({ sub: "u-123", email: "alice@example.org" });
    render(<ProfileDropdown token={token} onSignOut={() => {}} />);
    expect(
      screen.getByRole("button", { name: /alice@example\.org/ }),
    ).toBeInTheDocument();
  });

  it("falls back to sub when the JWT has no email claim", () => {
    const token = makeJwt({ sub: "u-456" });
    render(<ProfileDropdown token={token} onSignOut={() => {}} />);
    expect(screen.getByRole("button", { name: /u-456/ })).toBeInTheDocument();
  });

  it("opens a menu showing email, sub, expiry, and sign-out", async () => {
    const user = userEvent.setup();
    const exp = Math.floor(Date.UTC(2030, 0, 15, 12, 0, 0) / 1000);
    const token = makeJwt({ sub: "u-789", email: "bob@example.org", exp });
    render(<ProfileDropdown token={token} onSignOut={() => {}} />);

    // Menu hidden initially.
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /bob@example\.org/ }));

    const menu = screen.getByRole("menu");
    expect(menu).toBeInTheDocument();
    // Email shown in the open menu, sub shown as a secondary line.
    expect(menu).toHaveTextContent("bob@example.org");
    expect(menu).toHaveTextContent("u-789");
    // Expiry rendered as ISO-prefix YYYY-MM-DD so the test is locale-stable.
    expect(menu).toHaveTextContent("2030-01-15");
    expect(
      screen.getByRole("menuitem", { name: /sign out/i }),
    ).toBeInTheDocument();
  });

  it("renders 'no expiry' when the JWT lacks an exp claim", async () => {
    const user = userEvent.setup();
    const token = makeJwt({ sub: "u-noexp", email: "noexp@example.org" });
    render(<ProfileDropdown token={token} onSignOut={() => {}} />);
    await user.click(screen.getByRole("button"));
    expect(screen.getByRole("menu")).toHaveTextContent(/no expiry/i);
  });

  it("invokes onSignOut when the Sign out menu item is clicked", async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();
    const token = makeJwt({ sub: "u-1", email: "x@y.z" });
    render(<ProfileDropdown token={token} onSignOut={onSignOut} />);
    await user.click(screen.getByRole("button"));
    await user.click(screen.getByRole("menuitem", { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("closes the menu when the user clicks outside", async () => {
    const user = userEvent.setup();
    const token = makeJwt({ sub: "u-1", email: "x@y.z" });
    render(
      <div>
        <ProfileDropdown token={token} onSignOut={() => {}} />
        <button type="button">outside</button>
      </div>,
    );
    await user.click(screen.getByRole("button", { name: /x@y\.z/ }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "outside" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
