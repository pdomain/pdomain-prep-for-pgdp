/**
 * IllustrationsTool — stage tool surface for the Illustrations stage.
 *
 * Renders the three ILMain / ILGallery / ILSettings artboard panels:
 *   - Gate: status indicator (N regions need a look / All extracted)
 *   - Stats bar: detected / extracted / needs review / flagged
 *   - Kind breakdown: plate / lineart / initial / figure with export notes
 *   - Recent crops grid (4-up preview with status chip)
 *   - Gallery tab: full grid with filter segmented control + export button
 *
 * DCArtboard reference:
 *   docs/plans/design_handoff_pgdp_app/final/illustrations/illustrations.jsx
 *
 * @see src/machines/tools/illustrationsTool.ts
 * @see src/pages/pipeline/toolSlot.tsx — F5.4 registration
 */

import { useMemo, useState } from "react";
import { useActor } from "@xstate/react";
import { useParams } from "react-router-dom";
import {
  illustrationsToolMachine,
  type IllustrationKind,
  type IllustrationRegion,
  type GalleryFilter,
} from "@/machines/tools/illustrationsTool";
import type { ToolSlotProps } from "../toolSlot";
import { Button } from "@/components/ui/Button";
import { buildRealIllustrationsToolServices } from "@/services/tools/illustrationsTool";

// ---------------------------------------------------------------------------
// Kind definitions
// ---------------------------------------------------------------------------

const ILL_KINDS: Record<
  IllustrationKind,
  { name: string; tone: string; keep: string }
> = {
  plate: {
    name: "Plate",
    tone: "var(--ocr)",
    keep: "Contone · from grayscale · own DPI",
  },
  lineart: {
    name: "Line art",
    tone: "var(--exact)",
    keep: "Bilevel · from threshold",
  },
  initial: {
    name: "Initial",
    tone: "var(--fuzzy)",
    keep: "Contone or bilevel · auto-detect",
  },
  figure: {
    name: "Figure",
    tone: "var(--accent)",
    keep: "Contone · from grayscale",
  },
};

// ---------------------------------------------------------------------------
// Status chip
// ---------------------------------------------------------------------------

function StatusChip({ status }: { status: IllustrationRegion["status"] }) {
  const tone =
    status === "extracted"
      ? "var(--exact)"
      : status === "review"
        ? "var(--fuzzy)"
        : "var(--mismatch)";
  return (
    <span
      data-testid={`il-status-chip-${status}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        height: 18,
        padding: "0 7px",
        borderRadius: 9,
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: ".04em",
        color: tone,
        background: `color-mix(in oklab, ${tone} 13%, transparent)`,
      }}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Plate card
// ---------------------------------------------------------------------------

function PlateCard({
  item,
  compact,
  onConfirm,
  onDrop,
}: {
  item: IllustrationRegion;
  compact?: boolean;
  onConfirm?: () => void;
  onDrop?: () => void;
}) {
  const k = ILL_KINDS[item.kind];
  const ar = Math.max(0.5, Math.min(1.6, item.w / item.h));

  return (
    <div
      data-testid={`il-plate-card-${item.id}`}
      style={{
        border: "1px solid var(--border-1)",
        borderRadius: 8,
        overflow: "hidden",
        background: "var(--bg-surface)",
      }}
    >
      {/* Thumbnail area */}
      <div
        style={{
          position: "relative",
          aspectRatio: "4 / 3",
          background:
            "repeating-linear-gradient(135deg, color-mix(in oklab, var(--ink-4) 22%, var(--bg-sunk)) 0 7px, var(--bg-sunk) 7px 14px)",
          display: "grid",
          placeItems: "center",
        }}
      >
        <div
          style={{
            width: `${Math.round(ar >= 1 ? 70 : 70 * ar)}%`,
            aspectRatio: String(ar),
            background: "var(--bg-raised)",
            border: "1px dashed var(--border-3)",
            borderRadius: 2,
            display: "grid",
            placeItems: "center",
          }}
        >
          <span
            style={{
              fontFamily: "monospace",
              fontSize: 9.5,
              color: "var(--ink-4)",
              letterSpacing: ".04em",
            }}
          >
            {item.w}×{item.h}
          </span>
        </div>
        <span style={{ position: "absolute", top: 8, left: 8 }}>
          <StatusChip status={item.status} />
        </span>
      </div>

      {/* Caption */}
      <div style={{ padding: "9px 11px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
          }}
        >
          <span
            style={{
              fontFamily: "monospace",
              fontSize: 11,
              fontWeight: 600,
              color: "var(--ink-1)",
            }}
          >
            {item.page}
          </span>
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: 99,
              background: k.tone,
            }}
          />
          <span style={{ fontSize: 11, color: "var(--ink-2)" }}>{k.name}</span>
        </div>
        {!compact && (
          <div
            style={{
              marginTop: 4,
              fontSize: 10.5,
              color: "var(--ink-3)",
              lineHeight: 1.35,
            }}
          >
            {item.note}
          </div>
        )}
        <div
          style={{
            fontFamily: "monospace",
            marginTop: 5,
            fontSize: 9.5,
            color: "var(--ink-4)",
          }}
        >
          {k.keep}
        </div>
      </div>

      {/* Actions for review items */}
      {item.status === "review" && !compact && onConfirm && onDrop && (
        <div
          style={{
            padding: "8px 11px",
            borderTop: "1px solid var(--border-1)",
            display: "flex",
            gap: 6,
          }}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={onDrop}
            data-testid={`il-drop-btn-${item.id}`}
          >
            Drop
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onConfirm}
            data-testid={`il-confirm-btn-${item.id}`}
          >
            Confirm
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kind row in the breakdown card
// ---------------------------------------------------------------------------

function KindRow({
  kindId,
  items,
}: {
  kindId: IllustrationKind;
  items: IllustrationRegion[];
}) {
  const k = ILL_KINDS[kindId];
  const count = items.filter((i) => i.kind === kindId).length;
  if (count === 0) return null;
  return (
    <div
      data-testid={`il-kind-row-${kindId}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 0",
        borderTop: "1px solid var(--border-1)",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 99,
          background: k.tone,
          flex: "0 0 auto",
        }}
      />
      <span style={{ flex: 1, fontSize: 12.5, color: "var(--ink-1)" }}>
        {k.name}
      </span>
      <span
        style={{
          fontFamily: "monospace",
          fontSize: 11,
          color: "var(--ink-3)",
        }}
      >
        {k.keep}
      </span>
      <span
        style={{
          fontFamily: "monospace",
          width: 34,
          textAlign: "right",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--ink-2)",
        }}
      >
        {count}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gallery filter segmented control
// ---------------------------------------------------------------------------

const GALLERY_OPTIONS: { id: GalleryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "plates", label: "Plates" },
  { id: "lineart", label: "Line art" },
  { id: "initials", label: "Initials" },
  { id: "figures", label: "Figures" },
];

function GalleryFilterSeg({
  value,
  onChange,
}: {
  value: GalleryFilter;
  onChange: (v: GalleryFilter) => void;
}) {
  return (
    <div
      data-testid="il-gallery-filter"
      style={{
        display: "inline-flex",
        padding: 3,
        gap: 2,
        background: "var(--bg-raised)",
        border: "1px solid var(--border-1)",
        borderRadius: 7,
        flexWrap: "wrap",
      }}
    >
      {GALLERY_OPTIONS.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            data-testid={`il-filter-${opt.id}`}
            onClick={() => onChange(opt.id)}
            style={{
              padding: "5px 12px",
              borderRadius: 5,
              cursor: "pointer",
              background: active ? "var(--bg-surface)" : "transparent",
              boxShadow: active ? "0 0 0 1px var(--border-1)" : "none",
              color: active ? "var(--ink-1)" : "var(--ink-3)",
              fontSize: 12,
              fontWeight: active ? 600 : 500,
              border: "none",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type TabId = "main" | "gallery";

/**
 * IllustrationsTool — review surface for extracted illustration regions.
 *
 * Artboard DCArtboard states:
 *   - detecting: loading spinner
 *   - reviewing: gate + stats + kind breakdown + recent crops
 *   - extracted: settled gate + gallery
 *   - failed: error + retry
 *
 * @see docs/plans/design_handoff_pgdp_app/final/illustrations/illustrations.jsx
 */
export function IllustrationsTool({
  stageId: _stageId,
  runnerRef: _runnerRef,
}: ToolSlotProps) {
  const { projectId = "mock-project" } = useParams();

  const services = useMemo(
    () => buildRealIllustrationsToolServices(),
    [projectId],
  );

  const [snapshot, send] = useActor(illustrationsToolMachine, {
    input: {
      projectId,
      stageIndex: 11,
      services,
    },
  });

  const ctx = snapshot.context;
  const isDetecting = snapshot.matches("detecting");
  const isReviewing = snapshot.matches("reviewing");
  const isExtracted = snapshot.matches("extracted");
  const isFailed = snapshot.matches("failed");

  const [activeTab, setActiveTab] = useState<TabId>("main");

  // Filter gallery items
  const filteredItems = useMemo(() => {
    const items = ctx.items;
    if (ctx.galleryFilter === "all") return items;
    const kindMap: Record<GalleryFilter, string> = {
      all: "all",
      plates: "plate",
      lineart: "lineart",
      initials: "initial",
      figures: "figure",
    };
    return items.filter((i) => i.kind === kindMap[ctx.galleryFilter]);
  }, [ctx.items, ctx.galleryFilter]);

  if (isDetecting) {
    return (
      <div
        data-testid="il-detecting"
        style={{
          flex: 1,
          display: "grid",
          placeItems: "center",
          padding: 24,
          color: "var(--ink-3)",
          fontSize: 13,
        }}
      >
        Detecting illustration regions…
      </div>
    );
  }

  if (isFailed) {
    return (
      <div
        data-testid="il-failed"
        style={{
          flex: 1,
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ fontSize: 13, color: "var(--mismatch)" }}>
          {ctx.error?.message ?? "Detection failed"}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => send({ type: "RETRY" })}
          data-testid="il-retry-btn"
        >
          Retry
        </Button>
      </div>
    );
  }

  const counts = ctx.counts;
  const needsLook = (counts?.review ?? 0) + (counts?.flagged ?? 0) > 0;

  return (
    <div
      data-testid="illustrations-tool"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 16,
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* Gate banner */}
      <div
        data-testid={needsLook ? "il-gate-needs-look" : "il-gate-extracted"}
        style={{
          borderRadius: 10,
          border: `1px solid color-mix(in oklab, ${needsLook ? "var(--fuzzy)" : "var(--exact)"} 40%, var(--border-1))`,
          background: `color-mix(in oklab, ${needsLook ? "var(--fuzzy)" : "var(--exact)"} 7%, var(--bg-surface))`,
          padding: "14px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 7,
            flex: "0 0 auto",
            background: `color-mix(in oklab, ${needsLook ? "var(--fuzzy)" : "var(--exact)"} 18%, var(--bg-surface))`,
            color: needsLook ? "var(--fuzzy)" : "var(--exact)",
            display: "grid",
            placeItems: "center",
            fontSize: 15,
          }}
        >
          {needsLook ? "!" : "✓"}
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              color: "var(--ink-1)",
            }}
          >
            {needsLook
              ? `${(counts?.review ?? 0) + (counts?.flagged ?? 0)} regions need a look`
              : "All illustrations extracted"}
          </div>
          <div style={{ marginTop: 2, fontSize: 12, color: "var(--ink-3)" }}>
            {needsLook
              ? "Confirm the flagged detections and bounds below — extracted crops feed the proof pack's illustrations/ folder."
              : "Every detected region is cropped and named — ready for the proof pack."}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => send({ type: "REDETECT" })}
          data-testid="il-redetect-btn"
        >
          Re-detect
        </Button>
      </div>

      {/* Stats */}
      <div data-testid="il-stats" style={{ display: "flex", gap: 10 }}>
        {[
          {
            label: "detected",
            value: counts?.detected ?? 0,
            tone: "var(--ocr)",
          },
          {
            label: "extracted",
            value: counts?.extracted ?? 0,
            tone: "var(--exact)",
          },
          {
            label: "needs review",
            value: counts?.review ?? 0,
            tone: "var(--fuzzy)",
          },
          {
            label: "flagged",
            value: counts?.flagged ?? 0,
            tone: "var(--mismatch)",
          },
        ].map(({ label, value, tone }) => (
          <div
            key={label}
            data-testid={`il-stat-${label.replace(" ", "-")}`}
            style={{
              flex: 1,
              background: "var(--bg-surface)",
              border: "1px solid var(--border-1)",
              borderRadius: 8,
              padding: "14px 16px",
            }}
          >
            <div
              style={{
                fontFamily: "monospace",
                fontSize: 22,
                fontWeight: 600,
                color: tone,
                letterSpacing: "-0.01em",
              }}
            >
              {value}
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: 11,
                color: "var(--ink-3)",
                textTransform: "uppercase",
                letterSpacing: ".04em",
              }}
            >
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          gap: 4,
          borderBottom: "1px solid var(--border-1)",
          paddingBottom: 2,
        }}
      >
        {(["main", "gallery"] as const).map((tab) => (
          <button
            key={tab}
            data-testid={`il-tab-${tab}`}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "6px 14px",
              borderRadius: "6px 6px 0 0",
              border: "1px solid",
              borderColor:
                activeTab === tab ? "var(--border-1)" : "transparent",
              borderBottom:
                activeTab === tab
                  ? "1px solid var(--bg-page)"
                  : "1px solid transparent",
              background: activeTab === tab ? "var(--bg-page)" : "transparent",
              color: activeTab === tab ? "var(--ink-1)" : "var(--ink-3)",
              fontSize: 12.5,
              fontWeight: activeTab === tab ? 600 : 500,
              cursor: "pointer",
            }}
          >
            {tab === "main" ? "Overview" : "Gallery"}
          </button>
        ))}
      </div>

      {/* Main tab */}
      {activeTab === "main" && (
        <>
          {/* Kind breakdown */}
          <div
            data-testid="il-kind-breakdown"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-1)",
              borderRadius: 8,
              padding: "12px 16px",
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--ink-1)",
                marginBottom: 4,
              }}
            >
              Extraction by kind
            </div>
            <div
              style={{
                fontSize: 11.5,
                color: "var(--ink-3)",
                marginBottom: 8,
              }}
            >
              Each region type is kept at its own depth + resolution — plates
              stay contone, not bilevel
            </div>
            <div>
              {(Object.keys(ILL_KINDS) as IllustrationKind[]).map((kindId) => (
                <KindRow key={kindId} kindId={kindId} items={ctx.items} />
              ))}
            </div>
          </div>

          {/* Recent / review crops */}
          {isReviewing && (
            <div
              data-testid="il-review-crops"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-1)",
                borderRadius: 8,
                padding: "12px 16px",
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--ink-1)",
                  marginBottom: 12,
                }}
              >
                Regions needing review
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: 12,
                }}
              >
                {ctx.items
                  .filter(
                    (i) => i.status === "review" || i.status === "flagged",
                  )
                  .map((item) => (
                    <PlateCard
                      key={item.id}
                      item={item}
                      onConfirm={() =>
                        send({ type: "CONFIRM_REGION", regionId: item.id })
                      }
                      onDrop={() =>
                        send({ type: "DROP_REGION", regionId: item.id })
                      }
                    />
                  ))}
              </div>
            </div>
          )}

          {isExtracted && (
            <div
              data-testid="il-recently-extracted"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-1)",
                borderRadius: 8,
                padding: "12px 16px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 12,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--ink-1)",
                    }}
                  >
                    Recently extracted
                  </div>
                  <div
                    style={{
                      marginTop: 2,
                      fontSize: 11.5,
                      color: "var(--ink-3)",
                    }}
                  >
                    From illustration zones marked in Page layout
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveTab("gallery")}
                  data-testid="il-open-gallery-btn"
                >
                  Open gallery →
                </Button>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: 12,
                }}
              >
                {ctx.items.slice(0, 4).map((item) => (
                  <PlateCard key={item.id} item={item} compact />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Gallery tab */}
      {activeTab === "gallery" && (
        <div data-testid="il-gallery" style={{ flex: 1, minHeight: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <GalleryFilterSeg
              value={ctx.galleryFilter}
              onChange={(v) => send({ type: "SET_GALLERY_FILTER", value: v })}
            />
            <span style={{ flex: 1 }} />
            <span
              style={{
                fontFamily: "monospace",
                fontSize: 11,
                color: "var(--ink-3)",
              }}
            >
              {filteredItems.length} shown · {ctx.items.length} total
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => send({ type: "EXPORT_CROPS" })}
              data-testid="il-export-crops-btn"
            >
              Export crops
            </Button>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 14,
            }}
          >
            {filteredItems.map((item) => (
              <PlateCard key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
