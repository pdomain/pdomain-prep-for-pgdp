/**
 * Tests for SearchPanel — issue #76 acceptance criteria.
 *
 * Covers:
 * 1. Typing a query and submitting renders results with snippets.
 * 2. Clicking a result navigates to /projects/:id/pages/:idx0.
 * 3. Snippet highlights matched terms via <mark> elements.
 * 4. Pagination: Next 20 / Previous 20 buttons.
 * 5. Empty results show "No results." message.
 * 6. Error state shows failure message.
 * 7. Total count is displayed.
 * 8. Panel renders initially with just the search input (no results before first query).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { server } from "../test/server";
import { SearchPanel } from "./SearchPanel";

function renderWithProviders(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const MOCK_RESULTS = {
  results: [
    {
      page_id: "0000",
      idx0: 0,
      snippet: "some <b>matched</b> text here",
      score: 3.5,
    },
    {
      page_id: "0001",
      idx0: 1,
      snippet: "another <b>matched</b> word",
      score: 2.1,
    },
  ],
  total_count: 2,
};

describe("SearchPanel", () => {
  it("renders the search input and button initially", () => {
    renderWithProviders(<SearchPanel projectId="proj1" />);
    expect(
      screen.getByRole("searchbox", { name: /search query/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /search/i })).toBeInTheDocument();
    // No results before first query
    expect(screen.queryByTestId("search-results")).not.toBeInTheDocument();
  });

  it("shows results with snippets after submitting a query", async () => {
    server.use(
      http.get("/api/data/projects/proj1/search", ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("q") === "matched") {
          return HttpResponse.json(MOCK_RESULTS);
        }
        return HttpResponse.json({ results: [], total_count: 0 });
      }),
    );

    renderWithProviders(<SearchPanel projectId="proj1" />);

    const input = screen.getByRole("searchbox", { name: /search query/i });
    await userEvent.type(input, "matched");
    await userEvent.click(screen.getByRole("button", { name: /search/i }));

    await waitFor(() =>
      expect(screen.getByTestId("search-results")).toBeInTheDocument(),
    );

    expect(screen.getByText(/Page 1/)).toBeInTheDocument();
    expect(screen.getByText(/Page 2/)).toBeInTheDocument();
    expect(screen.getByText(/2 results/)).toBeInTheDocument();
  });

  it("renders snippet highlight as <mark> element", async () => {
    server.use(
      http.get("/api/data/projects/proj2/search", () =>
        HttpResponse.json(MOCK_RESULTS),
      ),
    );

    renderWithProviders(<SearchPanel projectId="proj2" />);

    const input = screen.getByRole("searchbox", { name: /search query/i });
    await userEvent.type(input, "matched");
    await userEvent.click(screen.getByRole("button", { name: /search/i }));

    await waitFor(() =>
      expect(screen.getAllByRole("mark")).not.toHaveLength(0),
    );

    const marks = screen.getAllByRole("mark");
    expect(marks[0]).toHaveTextContent("matched");
  });

  it("clicking a result renders a link to the page workbench", async () => {
    server.use(
      http.get("/api/data/projects/proj3/search", () =>
        HttpResponse.json(MOCK_RESULTS),
      ),
    );

    renderWithProviders(<SearchPanel projectId="proj3" />);

    const input = screen.getByRole("searchbox", { name: /search query/i });
    await userEvent.type(input, "matched");
    await userEvent.click(screen.getByRole("button", { name: /search/i }));

    await waitFor(() =>
      expect(screen.getByTestId("search-results")).toBeInTheDocument(),
    );

    const link = screen.getByTestId("result-link-0");
    expect(link).toHaveAttribute("href", "/projects/proj3/pages/0");
  });

  it("shows 'No results.' when there are no matches", async () => {
    server.use(
      http.get("/api/data/projects/proj4/search", () =>
        HttpResponse.json({ results: [], total_count: 0 }),
      ),
    );

    renderWithProviders(<SearchPanel projectId="proj4" />);

    const input = screen.getByRole("searchbox", { name: /search query/i });
    await userEvent.type(input, "zzznomatch");
    await userEvent.click(screen.getByRole("button", { name: /search/i }));

    await waitFor(() =>
      expect(screen.getByText(/no results/i)).toBeInTheDocument(),
    );
  });

  it("shows error message when search request fails", async () => {
    server.use(
      http.get("/api/data/projects/proj5/search", () =>
        HttpResponse.json({ detail: "server error" }, { status: 500 }),
      ),
    );

    renderWithProviders(<SearchPanel projectId="proj5" />);

    const input = screen.getByRole("searchbox", { name: /search query/i });
    await userEvent.type(input, "query");
    await userEvent.click(screen.getByRole("button", { name: /search/i }));

    await waitFor(() =>
      expect(screen.getByText(/search failed/i)).toBeInTheDocument(),
    );
  });

  it("Next 20 button advances the offset, Previous 20 goes back", async () => {
    // 45 total results — needs pagination.
    const mockPage1 = {
      results: [
        {
          page_id: "0000",
          idx0: 0,
          snippet: "hit on page <b>one</b>",
          score: 1.0,
        },
      ],
      total_count: 45,
    };
    const mockPage2 = {
      results: [
        {
          page_id: "0020",
          idx0: 20,
          snippet: "hit on page <b>two</b>",
          score: 1.0,
        },
      ],
      total_count: 45,
    };

    server.use(
      http.get("/api/data/projects/proj6/search", ({ request }) => {
        const url = new URL(request.url);
        const offset = Number(url.searchParams.get("offset") ?? "0");
        return HttpResponse.json(offset === 0 ? mockPage1 : mockPage2);
      }),
    );

    renderWithProviders(<SearchPanel projectId="proj6" />);

    const input = screen.getByRole("searchbox", { name: /search query/i });
    await userEvent.type(input, "hit");
    await userEvent.click(screen.getByRole("button", { name: /search/i }));

    // First page of results
    await waitFor(() => expect(screen.getByText(/Page 1/)).toBeInTheDocument());

    const nextBtn = screen.getByRole("button", { name: /next 20/i });
    expect(nextBtn).not.toBeDisabled();
    await userEvent.click(nextBtn);

    // Second page of results
    await waitFor(() =>
      expect(screen.getByText(/Page 21/)).toBeInTheDocument(),
    );

    const prevBtn = screen.getByRole("button", { name: /previous 20/i });
    expect(prevBtn).not.toBeDisabled();
    await userEvent.click(prevBtn);

    await waitFor(() => expect(screen.getByText(/Page 1/)).toBeInTheDocument());
  });

  it("displays the total result count from the API", async () => {
    server.use(
      http.get("/api/data/projects/proj7/search", () =>
        HttpResponse.json({ results: MOCK_RESULTS.results, total_count: 42 }),
      ),
    );

    renderWithProviders(<SearchPanel projectId="proj7" />);

    const input = screen.getByRole("searchbox", { name: /search query/i });
    await userEvent.type(input, "forty-two");
    await userEvent.click(screen.getByRole("button", { name: /search/i }));

    await waitFor(() =>
      expect(screen.getByText(/42 results/)).toBeInTheDocument(),
    );
  });
});
