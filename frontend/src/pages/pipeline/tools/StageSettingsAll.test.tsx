import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "@/api/client";
import { StageSettingsAllSection } from "./StageSettingsAll";

function renderSection(stageId: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <StageSettingsAllSection stageId={stageId} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("StageSettingsAllSection", () => {
  it("loads the stored app default and saves a change", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ skip_auto_deskew: true });
    const put = vi.spyOn(api, "put").mockResolvedValue({});
    renderSection("deskew");

    fireEvent.click(await screen.findByTestId("toggle-skip_auto_deskew"));
    fireEvent.click(screen.getByTestId("settings-all-deskew-save"));

    await waitFor(() => {
      expect(put).toHaveBeenCalledWith("/api/data/settings/stages/deskew", {
        skip_auto_deskew: false,
      });
    });
  });

  it("shows a load failure", async () => {
    vi.spyOn(api, "get").mockRejectedValue(new Error("offline"));
    renderSection("threshold");

    expect(await screen.findByText("offline")).toBeDefined();
  });
});
