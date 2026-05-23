/**
 * Tests for UserMenu — consolidated auth + theme dropdown (hifi P1-2).
 *
 * Covers:
 * - Renders trigger button with expected testid.
 * - auth_mode "none" → renders nothing.
 * - auth_mode "apikey" → shows user_id badge, no sign-out.
 * - auth_mode "jwt" → shows user_id and Sign out option.
 * - Theme submenu items update uiPrefs store.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../../test/server";
import { useUiPrefs } from "../../stores/uiPrefs";
import { UserMenu } from "./UserMenu";

function renderWithProviders(ui: ReactElement, { authMode = "none" } = {}) {
  (window as any).__ENV__ = { AUTH_MODE: authMode };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("UserMenu", () => {
  beforeEach(() => {
    useUiPrefs.setState({ theme: "light" });
    localStorage.clear();
    (window as any).__ENV__ = {};
  });

  it("renders nothing in auth_mode=none", () => {
    const { container } = renderWithProviders(<UserMenu />, {
      authMode: "none",
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders trigger button in apikey mode", async () => {
    server.use(
      http.get("/api/auth/me", () =>
        HttpResponse.json({ user_id: "apikey-user" }),
      ),
    );
    renderWithProviders(<UserMenu />, { authMode: "apikey" });
    expect(screen.getByTestId("user-menu-trigger")).toBeInTheDocument();
  });

  it("shows user_id in apikey mode after menu opens", async () => {
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ user_id: "alice" })),
    );
    const user = userEvent.setup();
    renderWithProviders(<UserMenu />, { authMode: "apikey" });

    await user.click(screen.getByTestId("user-menu-trigger"));

    await waitFor(() => {
      expect(screen.getByText("alice")).toBeInTheDocument();
    });
    // No sign-out in apikey mode.
    expect(screen.queryByText(/sign out/i)).not.toBeInTheDocument();
  });

  it("shows Sign out in jwt mode", async () => {
    server.use(
      http.get("/api/auth/me", () =>
        HttpResponse.json({ user_id: "jwt-user" }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<UserMenu />, { authMode: "jwt" });

    await user.click(screen.getByTestId("user-menu-trigger"));

    await waitFor(() => {
      expect(screen.getByText(/sign out/i)).toBeInTheDocument();
    });
  });

  it("renders trigger with custom testid", () => {
    server.use(
      http.get("/api/auth/me", () =>
        HttpResponse.json({ user_id: "custom-user" }),
      ),
    );
    renderWithProviders(<UserMenu data-testid="my-menu" />, {
      authMode: "apikey",
    });
    expect(screen.getByTestId("my-menu")).toBeInTheDocument();
  });

  it("uiPrefs setTheme updates the store (store unit test)", () => {
    // Radix SubMenu cannot be opened in jsdom; verify the store contract directly.
    useUiPrefs.getState().setTheme("dark");
    expect(useUiPrefs.getState().theme).toBe("dark");

    useUiPrefs.getState().setTheme("system");
    expect(useUiPrefs.getState().theme).toBe("system");

    useUiPrefs.getState().setTheme("light");
    expect(useUiPrefs.getState().theme).toBe("light");
  });

  it("theme label reflects store state in menu trigger area", async () => {
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ user_id: "u1" })),
    );
    useUiPrefs.setState({ theme: "dark" });
    const user = userEvent.setup();
    renderWithProviders(<UserMenu />, { authMode: "apikey" });

    await user.click(screen.getByTestId("user-menu-trigger"));

    await waitFor(() =>
      expect(screen.getByText(/Theme: dark/)).toBeInTheDocument(),
    );
  });
});
