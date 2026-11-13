/**
 * Tests for OpenTasksPopover — bell icon button that opens a floating panel
 * listing pages that need review (M5 hi-fi §Bell).
 *
 * Covers:
 * - Bell button is rendered with accessible label "Open tasks".
 * - Badge count is shown on the bell when tasks > 0.
 * - No badge when tasks == 0.
 * - Clicking the bell opens the popover with task list.
 * - Each task row has page name and "Review →" link.
 * - "All caught up" empty state when tasks == 0.
 * - Clicking "Review →" calls onSelectPage and closes popover.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { OpenTasksPopover } from "./OpenTasksPopover";

interface Task {
  id: string;
  label: string;
  href: string;
}

function renderIt(tasks: Task[], onSelect?: (t: Task) => void) {
  return render(
    <MemoryRouter>
      <div className="bg-slate-900 p-2">
        <OpenTasksPopover tasks={tasks} onSelectTask={onSelect ?? vi.fn()} />
      </div>
    </MemoryRouter>,
  );
}

describe("OpenTasksPopover", () => {
  it("renders bell button with accessible label", () => {
    renderIt([]);
    expect(
      screen.getByRole("button", { name: /open tasks/i }),
    ).toBeInTheDocument();
  });

  it("shows badge count when there are tasks", () => {
    const tasks: Task[] = [
      { id: "p1", label: "Page 0001", href: "/projects/x/pages/0001" },
      { id: "p2", label: "Page 0002", href: "/projects/x/pages/0002" },
    ];
    renderIt(tasks);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("does not show badge when tasks are empty", () => {
    renderIt([]);
    // No numeric badge — only the bell button
    expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument();
  });

  it("clicking bell opens popover with 'Open tasks' heading", async () => {
    renderIt([]);
    await userEvent.click(screen.getByRole("button", { name: /open tasks/i }));
    await waitFor(() =>
      expect(screen.getByText("Open tasks")).toBeInTheDocument(),
    );
  });

  it("shows 'All caught up' empty state when no tasks", async () => {
    renderIt([]);
    await userEvent.click(screen.getByRole("button", { name: /open tasks/i }));
    await waitFor(() =>
      expect(screen.getByText(/all caught up/i)).toBeInTheDocument(),
    );
  });

  it("lists task rows with review links when tasks exist", async () => {
    const tasks: Task[] = [
      { id: "p1", label: "Page 0001", href: "/projects/x/pages/0001" },
    ];
    renderIt(tasks);
    await userEvent.click(screen.getByRole("button", { name: /open tasks/i }));
    await waitFor(() =>
      expect(screen.getByText("Page 0001")).toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: /review/i })).toBeInTheDocument();
  });

  it("calls onSelectTask when Review link clicked", async () => {
    const onSelect = vi.fn();
    const tasks: Task[] = [
      { id: "p1", label: "Page 0001", href: "/projects/x/pages/0001" },
    ];
    renderIt(tasks, onSelect);
    await userEvent.click(screen.getByRole("button", { name: /open tasks/i }));
    await waitFor(() => screen.getByText("Page 0001"));
    await userEvent.click(screen.getByRole("link", { name: /review/i }));
    expect(onSelect).toHaveBeenCalledWith(tasks[0]);
  });
});
