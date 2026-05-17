// Vitest global setup — loaded once per test file via `setupFiles` in
// vite.config.ts. Registers @testing-library/jest-dom matchers (e.g.
// `toBeInTheDocument`) and wires the msw lifecycle so handlers reset
// between tests and unhandled requests fail loudly.
import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./server";

// jsdom does not implement ResizeObserver. Two components use it
// today (`WordBboxOverlay`, `PageWorkbenchPage`); mounting either in a
// test would otherwise throw `ReferenceError: ResizeObserver is not
// defined`. The minimal stub here records `observe` calls without
// firing callbacks — tests that need a size measurement should mock
// `Element.prototype.getBoundingClientRect` and either drive the
// initial sync `update()` (which the components run before installing
// the observer) or invoke the observer callback manually.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof globalThis.ResizeObserver === "undefined") {
  (globalThis as any).ResizeObserver = ResizeObserverStub;
}

// jsdom does not implement EventSource. Components using useStageEvents would
// throw at mount time without this stub. Tests that need real SSE event
// dispatch should override globalThis.EventSource with their own mock via
// vi.stubGlobal (as useStageEvents.test.tsx does).
class EventSourceStub {
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(_url: string) {}
  addEventListener(_type: string, _fn: unknown): void {}
  removeEventListener(_type: string, _fn: unknown): void {}
  close(): void {}
}
if (typeof globalThis.EventSource === "undefined") {
  (globalThis as any).EventSource = EventSourceStub;
}

// Start the mock server before any test runs.
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

// Reset any per-test handlers (added with `server.use(...)`) so a leak
// in one test can't contaminate the next.
afterEach(() => {
  server.resetHandlers();
});

// Tear down once the suite finishes.
afterAll(() => {
  server.close();
});
