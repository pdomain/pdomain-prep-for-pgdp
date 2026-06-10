import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tree, type TreeItem, type TreeItemTone } from "./Tree";

const FLAT_ITEMS: TreeItem[] = [
  { id: "f1", name: "project.zip", size: "12.4 MB", tone: "clean" },
  { id: "f2", name: "errors.log", tone: "error" },
  { id: "f3", name: "notes.txt", tone: "neutral" },
];

const NESTED_ITEMS: TreeItem[] = [
  {
    id: "root",
    name: "package",
    tone: "neutral",
    children: [
      { id: "sub1", name: "images/", tone: "clean" },
      { id: "sub2", name: "text/", tone: "dirty" },
    ],
  },
];

const TONES: TreeItemTone[] = ["clean", "dirty", "error", "neutral"];

describe("Tree", () => {
  it("renders with default testid", () => {
    render(<Tree items={FLAT_ITEMS} />);
    expect(screen.getByTestId("tree")).toBeInTheDocument();
  });

  it("renders all item names", () => {
    render(<Tree items={FLAT_ITEMS} />);
    expect(screen.getByText("project.zip")).toBeInTheDocument();
    expect(screen.getByText("errors.log")).toBeInTheDocument();
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
  });

  it("renders file sizes", () => {
    render(<Tree items={FLAT_ITEMS} />);
    expect(screen.getByText("12.4 MB")).toBeInTheDocument();
  });

  it("renders nested children", () => {
    render(<Tree items={NESTED_ITEMS} />);
    expect(screen.getByText("package")).toBeInTheDocument();
    expect(screen.getByText("images/")).toBeInTheDocument();
    expect(screen.getByText("text/")).toBeInTheDocument();
  });

  it("marks each tree item with data-tree-item", () => {
    render(<Tree items={FLAT_ITEMS} />);
    expect(document.querySelector("[data-tree-item='f1']")).toBeInTheDocument();
    expect(document.querySelector("[data-tree-item='f2']")).toBeInTheDocument();
  });

  it.each(TONES)("renders tone=%s without error", (tone) => {
    const items: TreeItem[] = [{ id: "x", name: "file.txt", tone }];
    const { container } = render(<Tree items={items} />);
    expect(container.firstChild).toBeTruthy();
  });

  it("forwards data-testid", () => {
    render(<Tree data-testid="my-tree" items={FLAT_ITEMS} />);
    expect(screen.getByTestId("my-tree")).toBeInTheDocument();
  });

  it("forwards data-screen-label", () => {
    render(<Tree data-screen-label="tree-label" items={[]} />);
    expect(screen.getByTestId("tree")).toHaveAttribute(
      "data-screen-label",
      "tree-label",
    );
  });

  it("forwards data-comment-anchor", () => {
    render(<Tree data-comment-anchor="anchor" items={[]} />);
    expect(screen.getByTestId("tree")).toHaveAttribute(
      "data-comment-anchor",
      "anchor",
    );
  });

  it("renders empty list without error", () => {
    render(<Tree items={[]} />);
    expect(screen.getByTestId("tree")).toBeInTheDocument();
  });
});
