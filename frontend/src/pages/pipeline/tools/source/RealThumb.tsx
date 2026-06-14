/**
 * RealThumb — displays an actual thumbnail image from the CDN when a
 * `thumbnailKey` is available, falling back to a paper-toned placeholder.
 *
 * URL convention: `/cdn/<thumbnailKey>` — the backend's filesystem CDN
 * serves all stored assets at this path. The key comes from
 * `PageRecord.thumbnail_key` via the pages API.
 *
 * @see src/api/cdn.py — CDN route definitions
 * @see frontend/src/api/types.gen.ts — PageRecord.thumbnail_key
 */

import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// FakePaperThumb — paper-toned placeholder (used as fallback / for inserts)
// ---------------------------------------------------------------------------

export function FakePaperThumb({
  tone = "light",
  kind,
  width,
  height,
}: {
  tone?: "light" | "mid" | "dark";
  /** "blank" renders a label; any other value renders ink lines. */
  kind?: string;
  width: number;
  height: number;
}): ReactNode {
  const paper =
    tone === "dark"
      ? "oklch(0.72 0.02 80)"
      : tone === "mid"
        ? "oklch(0.86 0.02 80)"
        : "oklch(0.95 0.012 85)";

  return (
    <div
      style={{
        width,
        height,
        borderRadius: 3,
        background: paper,
        boxShadow: "inset 0 0 0 1px rgba(40,30,20,0.15)",
        position: "relative",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {kind !== "blank" && (
        <div
          style={{
            position: "absolute",
            inset: "14% 12% 14% 12%",
            backgroundImage: `repeating-linear-gradient(
              to bottom,
              oklch(0.34 0.02 60) 0 1.5px,
              transparent 1.5px 7px
            )`,
            opacity: 0.7,
          }}
        />
      )}
      {kind === "blank" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            color: "var(--ink-4)",
            fontSize: 10,
            fontFamily: "var(--mono-font)",
            letterSpacing: ".08em",
            textTransform: "uppercase",
          }}
        >
          blank
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RealThumb — CDN image or FakePaperThumb fallback
// ---------------------------------------------------------------------------

/**
 * Props for RealThumb.
 *
 * - `thumbnailKey`: storage key served at `/cdn/<thumbnailKey>`. When null/
 *   undefined the placeholder is shown.
 * - `alt`: accessible alt text (defaults to "page thumbnail").
 * - `tone`, `kind`: passed to FakePaperThumb when no real image is available.
 */
export interface RealThumbProps {
  /** CDN key served at /cdn/<thumbnailKey>. Omit to use FakePaperThumb. */
  thumbnailKey?: string;
  alt?: string;
  tone?: "light" | "mid" | "dark";
  /** "blank" renders a label; any other value renders ink lines. */
  kind?: string;
  width: number;
  height: number;
}

/**
 * Renders a real thumbnail image when `thumbnailKey` is provided, falling
 * back to `FakePaperThumb`.
 *
 * The image uses `object-fit: cover` so it fills the target dimensions
 * without letterboxing regardless of source aspect ratio.
 */
export function RealThumb({
  thumbnailKey,
  alt = "page thumbnail",
  tone,
  kind,
  width,
  height,
}: RealThumbProps): ReactNode {
  if (!thumbnailKey) {
    return (
      <FakePaperThumb
        {...(tone !== undefined ? { tone } : {})}
        {...(kind !== undefined ? { kind } : {})}
        width={width}
        height={height}
      />
    );
  }

  const url = `/cdn/${thumbnailKey}`;

  return (
    <div
      style={{
        width,
        height,
        borderRadius: 3,
        overflow: "hidden",
        position: "relative",
        flexShrink: 0,
        boxShadow: "inset 0 0 0 1px rgba(40,30,20,0.10)",
      }}
    >
      <img
        src={url}
        alt={alt}
        loading="lazy"
        decoding="async"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
        }}
        onError={(e) => {
          // On load failure, replace with a paper placeholder
          const target = e.currentTarget;
          target.style.display = "none";
          const parent = target.parentElement;
          if (parent) {
            parent.style.background =
              tone === "dark"
                ? "oklch(0.72 0.02 80)"
                : tone === "mid"
                  ? "oklch(0.86 0.02 80)"
                  : "oklch(0.95 0.012 85)";
          }
        }}
      />
    </div>
  );
}
