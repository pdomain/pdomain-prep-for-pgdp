/**
 * Tests for SearchModal — global search dialog (hifi P1-2).
 *
 * Phase 2.7c (#330): SearchModal now accepts explicit open/onOpenChange props
 * so searchOpen state lives in App.tsx (local React state) rather than the
 * uiPrefs store. The uiPrefs store is now theme-only.
 *
 * Covers:
 * - Renders without crashing (closed by default, no visible content).
 * - Opens when open=true prop is passed.
 * - Closes when the X button is clicked (onOpenChange called with false).
 * - Shows "Navigate to a project" message when no project route is active.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SearchModal } from "./SearchModal";

// react-hotkeys-hook fires keyboard listeners; stub it out to keep tests fast.
vi.mock("react-hotkeys-hook", () => ({
  useHotkeys: vi.fn(),
}));

function renderWithProviders(ui: ReactElement, { initialPath = "/" } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("SearchModal", () => {
  const noop = () => undefined;

  beforeEach(() => {
    // No store setup needed — SearchModal no longer reads from uiPrefs.
  });

  it("renders without crashing and is closed by default", () => {
    renderWithProviders(<SearchModal open={false} onOpenChange={noop} />);
    // Dialog content is not in DOM when closed (Radix Dialog Portal).
    expect(screen.queryByTestId("search-modal")).not.toBeInTheDocument();
  });

  it("shows modal content when open=true", () => {
    renderWithProviders(<SearchModal open={true} onOpenChange={noop} />);
    expect(screen.getByTestId("search-modal")).toBeInTheDocument();
  });

  it("shows 'Navigate to a project' when not on a project route", () => {
    renderWithProviders(<SearchModal open={true} onOpenChange={noop} />, {
      initialPath: "/",
    });
    expect(
      screen.getByText(/navigate to a project to search/i),
    ).toBeInTheDocument();
  });

  it("shows search-panel when on a project route", () => {
    renderWithProviders(<SearchModal open={true} onOpenChange={noop} />, {
      initialPath: "/projects/proj-abc",
    });
    expect(screen.getByTestId("search-panel")).toBeInTheDocument();
  });

  it("calls onOpenChange(false) when the X button is clicked", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <SearchModal open={true} onOpenChange={onOpenChange} />,
    );

    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("accepts a custom data-testid", () => {
    renderWithProviders(
      <SearchModal open={true} onOpenChange={noop} data-testid="my-search" />,
    );
    expect(screen.getByTestId("my-search")).toBeInTheDocument();
  });
});
