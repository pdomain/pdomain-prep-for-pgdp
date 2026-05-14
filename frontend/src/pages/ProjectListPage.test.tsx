/**
 * Component-mount test for the inline `CreateProjectModal` rendered by
 * `ProjectListPage`. Roadmap §9 step 11 ("stretch") — the first
 * Testing-Library test that mounts a real React subtree (QueryClientProvider
 * + MemoryRouter) and exercises the create-project happy path through the
 * msw wire layer.
 *
 * Scope is deliberately one test. Wire-level coverage of `POST
 * /api/data/projects` already lives in `api/client.test.ts`; what this test
 * adds is proof that the modal actually drives that POST when a user types a
 * name, picks a file, and clicks "Create + Upload". The XHR `PUT` upload and
 * the follow-up `POST /api/gpu/ingest` are stubbed minimally so the mutation
 * resolves and we can assert the project-create POST body (the smallest
 * thing that proves the modal is wired).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import type { components } from "../api/types.gen";

type CreateProjectRequest = components["schemas"]["CreateProjectRequest"];
type CreateProjectResponse = components["schemas"]["CreateProjectResponse"];
type Project = components["schemas"]["Project"];
import { server } from "../test/server";
import { ProjectListPage } from "./ProjectListPage";

function renderWithProviders(ui: ReactElement) {
  // Fresh QueryClient per test so cache state can't leak across files.
  // Retry off so error paths surface immediately without exponential
  // backoff blowing the test timeout.
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

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "prj_abc123",
    owner_id: "user_local",
    name: "Belloc — The Four Men",
    created_at: "2026-05-06T00:00:00Z",
    updated_at: "2026-05-06T00:00:00Z",
    status: "ingesting",
    page_count: 0,
    proof_page_count: 0,
    storage_prefix: "projects/prj_abc123",
    archived: false,
    pipeline_state: { steps: {} },
    config: {
      book_name: "Belloc — The Four Men",
      source_uri: "uploads/prj_abc123/source.zip",
      proof_start_idx0: 0,
      proof_end_idx0: 0,
      cover_idx0: null,
      title_idx0: null,
      frontmatter_start_idx0: 0,
      frontmatter_end_idx0: 0,
      bodymatter_start_idx0: 0,
      bodymatter_end_idx0: 0,
      frontmatter_page_nbr_start: 1,
      bodymatter_page_nbr_start: 1,
      initial_crop_all: [0, 0, 0, 0],
      ocr_crop_top: 0,
      ocr_crop_bottom: 0,
      ocr_crop_left: 0,
      ocr_crop_right: 0,
      custom_regex_passes: [],
      custom_scannos: {},
      layout_category_overrides: {},
      optimize_png: true,
      default_overrides: {},
    },
    ...overrides,
  };
}

describe("ProjectListPage CreateProjectModal a11y", () => {
  it("renders as a labelled modal dialog with body scroll lock while open", async () => {
    server.use(http.get("/api/data/projects", () => HttpResponse.json([])));

    renderWithProviders(<ProjectListPage />);

    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: /new project/i }),
    );

    // Modality is enforced by Radix's focus trap + body scroll-lock,
    // not by the `aria-modal` attribute (Radix v1.1+ deliberately omits
    // it because the WAI-ARIA modal pattern is satisfied by the focus
    // trap alone). The cba526e contract still holds in spirit: the
    // dialog is discoverable by `role="dialog"` with its accessible name,
    // and background scroll is locked while it's open.
    //
    // Scroll-lock under Radix uses `react-remove-scroll-bar`, which
    // sets `data-scroll-locked` on <body> and applies `overflow: hidden`
    // via an injected stylesheet (jsdom doesn't compute the stylesheet,
    // so we assert the attribute the lock manager actually owns).
    await screen.findByRole("dialog", { name: /new project/i });
    expect(document.body.hasAttribute("data-scroll-locked")).toBe(true);
  });

  it("closes when the user presses Escape and restores body overflow", async () => {
    server.use(http.get("/api/data/projects", () => HttpResponse.json([])));

    renderWithProviders(<ProjectListPage />);

    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: /new project/i }),
    );

    await screen.findByRole("dialog", { name: /new project/i });
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    // Scroll-lock attribute is removed by Radix when the dialog closes.
    expect(document.body.hasAttribute("data-scroll-locked")).toBe(false);
  });

  it("focuses the first interactive control on open", async () => {
    server.use(http.get("/api/data/projects", () => HttpResponse.json([])));

    renderWithProviders(<ProjectListPage />);

    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: /new project/i }),
    );

    await screen.findByRole("dialog", { name: /new project/i });
    // The book-name input is the first focusable control inside the
    // dialog, so the focus-trap initial-focus pass should land there.
    const nameInput = screen.getByPlaceholderText(/Belloc/i);
    expect(document.activeElement).toBe(nameInput);
  });
});

describe("ProjectListPage delete confirm uses AlertDialog (§13a step 1b)", () => {
  it("opens an alertdialog with project name in the description and locks scroll", async () => {
    server.use(
      http.get("/api/data/projects", () =>
        HttpResponse.json([makeProject({ name: "Belloc — The Four Men" })]),
      ),
    );

    renderWithProviders(<ProjectListPage />);

    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: /delete project/i }),
    );

    // Radix sets role="alertdialog" (NOT "dialog"); accessible name
    // wires from <AlertDialogTitle>.
    const dlg = await screen.findByRole("alertdialog", {
      name: /delete project/i,
    });
    // The destination project's name appears in the body so the user
    // can confirm what they're about to delete.
    expect(dlg).toHaveTextContent(/Belloc/);
    expect(document.body.hasAttribute("data-scroll-locked")).toBe(true);
  });

  it("calls DELETE /api/data/projects/:id and closes when Delete is confirmed", async () => {
    let deleteCalled = false;
    server.use(
      http.get("/api/data/projects", () => HttpResponse.json([makeProject()])),
      http.delete("/api/data/projects/prj_abc123", () => {
        deleteCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderWithProviders(<ProjectListPage />);

    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: /delete project/i }),
    );
    await screen.findByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    // After confirm, the alertdialog unmounts and the row's mutation
    // fired DELETE.
    await screen.findByRole("button", { name: /delete project/i });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(deleteCalled).toBe(true);
  });

  it("does NOT call DELETE when Cancel is clicked", async () => {
    let deleteCalled = false;
    server.use(
      http.get("/api/data/projects", () => HttpResponse.json([makeProject()])),
      http.delete("/api/data/projects/prj_abc123", () => {
        deleteCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderWithProviders(<ProjectListPage />);

    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: /delete project/i }),
    );
    await screen.findByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(deleteCalled).toBe(false);
  });
});

describe("ProjectListPage create-project flow", () => {
  it("submits the name + zip upload and POSTs CreateProjectRequest with source_type=zip", async () => {
    const createCalls: CreateProjectRequest[] = [];
    let ingestCalled = false;

    server.use(
      // Initial list query the page fires on mount.
      http.get("/api/data/projects", () => HttpResponse.json([])),

      // The create-project POST that the modal's mutation drives — this
      // is the assertion target.
      http.post("/api/data/projects", async ({ request }) => {
        createCalls.push((await request.json()) as CreateProjectRequest);
        const body: CreateProjectResponse = {
          project: makeProject(),
          upload_url: "/cdn/uploads/prj_abc123/source.zip",
          upload_key: "uploads/prj_abc123/source.zip",
        };
        return HttpResponse.json(body, { status: 201 });
      }),

      // The XHR PUT upload — msw's XMLHttpRequestInterceptor catches
      // this in jsdom. Empty 200 is enough for `xhr.onload` to resolve.
      http.put("/cdn/uploads/prj_abc123/source.zip", () =>
        HttpResponse.text("", { status: 200 }),
      ),

      // Final ingest enqueue. We don't assert its body here — the
      // wire-level contract for /api/gpu/ingest belongs in a future
      // dedicated test if it grows. We just need it to succeed so the
      // mutation reaches onSuccess.
      http.post("/api/gpu/ingest", () => {
        ingestCalled = true;
        return HttpResponse.json({ job_id: "job_1", status: "queued" });
      }),
    );

    renderWithProviders(<ProjectListPage />);

    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: /new project/i }),
    );

    await user.type(
      screen.getByPlaceholderText(/Belloc/i),
      "Belloc — The Four Men",
    );

    const file = new File(["dummy zip bytes"], "scans.zip", {
      type: "application/zip",
    });
    // The file input has no label — find it by type via the modal subtree.
    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(fileInput, file);

    await user.click(screen.getByRole("button", { name: /create \+ upload/i }));

    // Wait until the modal hits a post-form state. `findBy*` polls for
    // up to 1s, which covers the XHR + ingest POST round-trips.
    await screen.findByText(/Uploading|Error/i, undefined, { timeout: 2000 });

    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]).toEqual({
      name: "Belloc — The Four Men",
      source_type: "zip",
    } satisfies CreateProjectRequest);
    expect(ingestCalled).toBe(true);
  });
});
