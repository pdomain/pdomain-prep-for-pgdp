/**
 * Tests for useStageEvents — SSE hook that subscribes to per-page stage
 * transitions and seeds/updates the TanStack Query cache in real time.
 *
 * EventSource is not available in jsdom so it is stubbed for each test.
 * The hook is exercised via renderHook; cache mutations are verified by
 * reading back from a shared QueryClient.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { components } from "../api/types.gen";
import { useStageEvents } from "./useStageEvents";

type PageStageState = components["schemas"]["PageStageState"];

function makeRow(stage_id: string, status: string = "not-run"): PageStageState {
  return {
    project_id: "p1",
    page_id: "0000",
    stage_id,
    status,
    stage_version: 1,
    artifact_key: null,
    config_hash: null,
    input_hash: null,
    last_run_at: null,
    duration_ms: null,
    error_message: null,
    job_id: null,
  } as PageStageState;
}

// Minimal EventSource stub that captures addEventListener calls and lets
// tests emit named events synchronously.
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  readyState = 1; // OPEN
  onerror: ((e: Event) => void) | null = null;
  private _listeners = new Map<string, Set<(e: MessageEvent) => void>>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type)!.add(fn);
  }

  removeEventListener(type: string, fn: (e: MessageEvent) => void) {
    this._listeners.get(type)?.delete(fn);
  }

  close() {
    this.readyState = 2; // CLOSED
  }

  /** Emit a named SSE event with a JSON-serialised payload. */
  emit(type: string, data: object) {
    const e = new MessageEvent(type, { data: JSON.stringify(data) });
    this._listeners.get(type)?.forEach((fn) => fn(e));
  }

  emitError() {
    this.onerror?.(new Event("error"));
  }
}

let qc: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  ) as React.ReactElement;
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  qc.clear();
});

// ─── Connection ─────────────────────────────────────────────────────────────

describe("useStageEvents connection", () => {
  it("opens an EventSource to the correct URL", () => {
    renderHook(() => useStageEvents("p1", 0), { wrapper });
    expect(MockEventSource.instances.length).toBe(1);
    expect(MockEventSource.instances[0]!.url).toBe(
      "/api/data/projects/p1/pages/0/events",
    );
  });

  it("does not open EventSource when projectId is null", () => {
    renderHook(() => useStageEvents(null, 0), { wrapper });
    expect(MockEventSource.instances.length).toBe(0);
  });

  it("closes the EventSource on unmount", () => {
    const { unmount } = renderHook(() => useStageEvents("p1", 0), { wrapper });
    const es = MockEventSource.instances[0]!;
    unmount();
    expect(es.readyState).toBe(2);
  });
});

// ─── Snapshot event ─────────────────────────────────────────────────────────

describe("useStageEvents snapshot", () => {
  it("seeds the query cache with stage rows from the snapshot", () => {
    renderHook(() => useStageEvents("p1", 0), { wrapper });
    const es = MockEventSource.instances[0]!;

    act(() => {
      es.emit("snapshot", {
        type: "snapshot",
        stages: [makeRow("grayscale", "clean"), makeRow("threshold", "dirty")],
      });
    });

    const cached = qc.getQueryData<PageStageState[]>(["page-stages", "p1", 0]);
    expect(cached).not.toBeUndefined();
    expect(cached?.length).toBe(2);
    expect(cached?.find((s) => s.stage_id === "grayscale")?.status).toBe(
      "clean",
    );
  });
});

// ─── stage-status event ──────────────────────────────────────────────────────

describe("useStageEvents stage-status", () => {
  it("updates the cached stage row on stage-status event", () => {
    renderHook(() => useStageEvents("p1", 0), { wrapper });
    const es = MockEventSource.instances[0]!;

    act(() => {
      es.emit("snapshot", {
        type: "snapshot",
        stages: [
          makeRow("grayscale", "dirty"),
          makeRow("threshold", "not-run"),
        ],
      });
    });

    act(() => {
      es.emit("stage-status", {
        type: "stage-status",
        stage_id: "grayscale",
        status: "clean",
      });
    });

    const cached = qc.getQueryData<PageStageState[]>(["page-stages", "p1", 0]);
    expect(cached?.find((s) => s.stage_id === "grayscale")?.status).toBe(
      "clean",
    );
    // Other rows unchanged.
    expect(cached?.find((s) => s.stage_id === "threshold")?.status).toBe(
      "not-run",
    );
  });

  it("also handles stage-progress events the same way", () => {
    renderHook(() => useStageEvents("p1", 0), { wrapper });
    const es = MockEventSource.instances[0]!;

    act(() => {
      es.emit("snapshot", {
        type: "snapshot",
        stages: [makeRow("grayscale", "not-run")],
      });
    });

    act(() => {
      es.emit("stage-progress", {
        type: "stage-progress",
        stage_id: "grayscale",
        status: "running",
      });
    });

    const cached = qc.getQueryData<PageStageState[]>(["page-stages", "p1", 0]);
    expect(cached?.find((s) => s.stage_id === "grayscale")?.status).toBe(
      "running",
    );
  });
});
