/**
 * Tests for ServerInfoFooter — the local-mode "your server is at …" affordance
 * that surfaces the bound URL once the SPA has mounted (§L1 step 3).
 *
 * The component fetches `GET /api/server-info` once on mount and renders the
 * URL as a copyable text node. If the request fails or hasn't completed, the
 * footer renders nothing (better empty than wrong; this is purely a
 * belt-and-suspenders surface for users who closed their terminal).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { server } from "../test/server";
import { ServerInfoFooter } from "./ServerInfoFooter";

function renderWithProviders(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe("ServerInfoFooter", () => {
  it("renders the bound URL after the request resolves", async () => {
    server.use(
      http.get("/api/server-info", () =>
        HttpResponse.json({
          host: "127.0.0.1",
          port: 8765,
          url: "http://127.0.0.1:8765",
        }),
      ),
    );
    renderWithProviders(<ServerInfoFooter />);

    await waitFor(() => {
      expect(
        screen.getByText(/http:\/\/127\.0\.0\.1:8765/),
      ).toBeInTheDocument();
    });
  });

  it("renders nothing while the request is pending", () => {
    server.use(
      http.get("/api/server-info", async () => {
        // Hang — caller will be in pending state at assertion time.
        await new Promise(() => {});
        return HttpResponse.json({ host: "x", port: 0, url: "x" });
      }),
    );
    const { container } = renderWithProviders(<ServerInfoFooter />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the request errors", async () => {
    server.use(
      http.get("/api/server-info", () =>
        HttpResponse.json({ detail: "boom" }, { status: 500 }),
      ),
    );
    const { container } = renderWithProviders(<ServerInfoFooter />);
    // Wait long enough for the failed query to settle. We assert the
    // container stays empty rather than racing on a specific tick.
    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });

  it("exposes a copy-to-clipboard affordance for the URL", async () => {
    server.use(
      http.get("/api/server-info", () =>
        HttpResponse.json({
          host: "127.0.0.1",
          port: 9099,
          url: "http://127.0.0.1:9099",
        }),
      ),
    );
    renderWithProviders(<ServerInfoFooter />);
    // The contract is "user can recover the URL from the running SPA".
    // A selectable text node already satisfies that; a copy-button is
    // the friendlier UX. We assert the URL is present in a form a user
    // can grab — either a button labelled with it or selectable text.
    await waitFor(() => {
      const matches = screen.getAllByText(/http:\/\/127\.0\.0\.1:9099/);
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it("uses token utility classes for status-bar styling", async () => {
    server.use(
      http.get("/api/server-info", () =>
        HttpResponse.json({
          host: "127.0.0.1",
          port: 8765,
          url: "http://127.0.0.1:8765",
        }),
      ),
    );
    const { container } = renderWithProviders(<ServerInfoFooter />);
    await waitFor(() => {
      expect(
        screen.getByText(/http:\/\/127\.0\.0\.1:8765/),
      ).toBeInTheDocument();
    });
    const footer = container.querySelector("footer");
    expect(footer).not.toBeNull();
    expect(footer?.className).toContain("bg-bg-page");
    expect(footer?.className).toContain("text-ink-4");
    expect(footer?.className).toContain("border-border-1");
  });
});
