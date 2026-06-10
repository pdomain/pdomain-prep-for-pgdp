/**
 * Tree — file/artefact tree display for pack-group stage tools.
 *
 * Used in archive, build_package, proof_pack, zip, submit_check, and
 * validation stage tools to render the PGDP artefact tree structure.
 * PGDP-specific artefact-tree shape (filename, size, status tone).
 *
 * Disposition: stays app-local (see docs/specs/library-placement.md §1.3).
 *
 * Token-only styling; no hex literals.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type TreeItemTone = "clean" | "dirty" | "error" | "neutral";

export interface TreeItem {
  /** Unique identifier for this tree node. */
  id: string;
  /** Display name (filename or folder name). */
  name: string;
  /** Optional size string (e.g. "1.2 MB"). */
  size?: string;
  /** Status tone for visual differentiation. */
  tone?: TreeItemTone;
  /** Nested children (renders as indented subtree). */
  children?: TreeItem[];
}

const TONE_CLASSES: Record<TreeItemTone, string> = {
  clean: "text-[color:var(--exact)]",
  dirty: "text-[color:var(--fuzzy)]",
  error: "text-[color:var(--mismatch)]",
  neutral: "text-ink-2",
};

interface TreeNodeProps {
  item: TreeItem;
  depth: number;
}

function TreeNode({ item, depth }: TreeNodeProps): ReactNode {
  const tone = item.tone ?? "neutral";
  const hasChildren = item.children && item.children.length > 0;
  return (
    <li data-tree-item={item.id}>
      <div
        className={cn(
          "flex items-center gap-2 py-0.5 font-mono text-xs leading-relaxed",
          TONE_CLASSES[tone],
        )}
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        <span
          className="text-ink-4 flex-none w-3 text-center"
          aria-hidden="true"
        >
          {hasChildren ? "▾" : "·"}
        </span>
        <span className="flex-1 min-w-0 truncate">{item.name}</span>
        {item.size ? (
          <span className="text-ink-4 flex-none">{item.size}</span>
        ) : null}
      </div>
      {hasChildren ? (
        <ul>
          {(item.children ?? []).map((child) => (
            <TreeNode key={child.id} item={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export interface TreeProps {
  items: TreeItem[];
  className?: string;
  "data-testid"?: string;
  "data-screen-label"?: string;
  "data-comment-anchor"?: string;
}

export function Tree({
  items,
  className,
  "data-testid": testId,
  "data-screen-label": screenLabel,
  "data-comment-anchor": commentAnchor,
}: TreeProps) {
  return (
    <ul
      data-testid={testId ?? "tree"}
      data-screen-label={screenLabel}
      data-comment-anchor={commentAnchor}
      className={cn(
        "rounded-md border border-border-1 bg-bg-sunk py-2 overflow-auto",
        className,
      )}
    >
      {items.map((item) => (
        <TreeNode key={item.id} item={item} depth={0} />
      ))}
    </ul>
  );
}
