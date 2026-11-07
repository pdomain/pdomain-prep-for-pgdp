import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import {
  loadValidationPreflight,
  preflightFromValidationReport,
} from "./preflightStatus";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
}));

describe("preflightFromValidationReport", () => {
  it("passes only a clean report", () => {
    expect(
      preflightFromValidationReport({ passed: true, blocker_count: 0 }),
    ).toBe("passed");
  });

  it("blocks when the report has a blocker", () => {
    expect(
      preflightFromValidationReport({ passed: false, blocker_count: 2 }),
    ).toBe("blocked");
  });

  it("blocks when passed is false even with a zero count", () => {
    expect(
      preflightFromValidationReport({ passed: false, blocker_count: 0 }),
    ).toBe("blocked");
  });

  it("blocks when passed is true but blockers remain", () => {
    expect(
      preflightFromValidationReport({ passed: true, blocker_count: 1 }),
    ).toBe("blocked");
  });

  it("is unknown when the report is missing", () => {
    expect(preflightFromValidationReport(null)).toBe("unknown");
  });
});

describe("loadValidationPreflight", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it("reads a clean artifact", async () => {
    vi.mocked(api.get).mockResolvedValue({
      passed: true,
      blocker_count: 0,
    });
    await expect(loadValidationPreflight("book-1")).resolves.toBe("passed");
  });

  it("stays unknown when the artifact is missing", async () => {
    vi.mocked(api.get).mockRejectedValue(
      Object.assign(new Error("HTTP 404"), { status: 404 }),
    );
    await expect(loadValidationPreflight("book-1")).resolves.toBe("unknown");
  });

  it("stays unknown when the body is not a report", async () => {
    vi.mocked(api.get).mockResolvedValue({ ok: true });
    await expect(loadValidationPreflight("book-1")).resolves.toBe("unknown");
  });
});
