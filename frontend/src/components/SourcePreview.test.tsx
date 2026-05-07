/**
 * Tests for SourcePreview — the thumbnail-strip component shown after a
 * source.zip upload but before/while ingest runs (roadmap §8 / P2 #8 slice 4).
 *
 * The component fetches `GET /api/data/projects/{id}/source-preview?limit=N`
 * for filenames + total count, then renders one `<img>` per filename pointing
 * at the matching `/source-preview/{filename}/thumbnail` route. The image
 * route returns binary JPEG bytes so the test does not need to mock those —
 * it only asserts the `src` attribute is correctly formed.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { server } from "../test/server";
import { SourcePreview } from "./SourcePreview";

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

describe("SourcePreview", () => {
  it("renders filenames and an <img> per entry once the preview loads", async () => {
    server.use(
      http.get("/api/data/projects/prj_abc/source-preview", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("limit")).toBe("10");
        return HttpResponse.json({
          filenames: ["0001.jpg", "0002.jpg", "0003.jpg"],
          total_image_count: 42,
        });
      }),
    );

    renderWithProviders(<SourcePreview projectId="prj_abc" />);

    // Filename labels render after the query resolves.
    await waitFor(() =>
      expect(screen.getByText("0001.jpg")).toBeInTheDocument(),
    );
    expect(screen.getByText("0002.jpg")).toBeInTheDocument();
    expect(screen.getByText("0003.jpg")).toBeInTheDocument();

    // "Showing N of M" hint surfaces total_image_count.
    expect(screen.getByText(/3 of 42/)).toBeInTheDocument();

    // Each filename renders an <img> pointing at the matching
    // thumbnail route. Filenames are URL-encoded into the path so
    // entries with spaces/slashes survive the round-trip.
    const imgs = screen.getAllByRole("img");
    expect(imgs).toHaveLength(3);
    expect(imgs[0]).toHaveAttribute(
      "src",
      "/api/data/projects/prj_abc/source-preview/0001.jpg/thumbnail",
    );
    expect(imgs[2]).toHaveAttribute(
      "src",
      "/api/data/projects/prj_abc/source-preview/0003.jpg/thumbnail",
    );
  });

  it("URL-encodes filenames with special characters in the thumbnail src", async () => {
    server.use(
      http.get("/api/data/projects/prj_xyz/source-preview", () =>
        HttpResponse.json({
          filenames: ["sub dir/page 01.jpg"],
          total_image_count: 1,
        }),
      ),
    );

    renderWithProviders(<SourcePreview projectId="prj_xyz" />);

    const img = await screen.findByRole("img");
    // encodeURIComponent escapes both " " (→ %20) and "/" (→ %2F),
    // matching how FastAPI matches the `{filename}` path parameter.
    expect(img).toHaveAttribute(
      "src",
      "/api/data/projects/prj_xyz/source-preview/sub%20dir%2Fpage%2001.jpg/thumbnail",
    );
  });

  it("shows a friendly message when the source.zip has not landed yet (404)", async () => {
    server.use(
      http.get(
        "/api/data/projects/prj_404/source-preview",
        () =>
          new HttpResponse(
            JSON.stringify({ detail: "source zip not uploaded" }),
            {
              status: 404,
              headers: { "Content-Type": "application/json" },
            },
          ),
      ),
    );

    renderWithProviders(<SourcePreview projectId="prj_404" />);

    await waitFor(() =>
      expect(
        screen.getByText(/source zip is not yet available/i),
      ).toBeInTheDocument(),
    );
  });

  it("renders nothing visible while the preview query is still loading", () => {
    // No handler registered for this projectId, so the fetch hangs in msw.
    // The component should render its placeholder shimmer.
    server.use(
      http.get("/api/data/projects/prj_loading/source-preview", async () => {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        return HttpResponse.json({ filenames: [], total_image_count: 0 });
      }),
    );

    renderWithProviders(<SourcePreview projectId="prj_loading" />);
    expect(screen.getByText(/loading preview/i)).toBeInTheDocument();
  });
});
