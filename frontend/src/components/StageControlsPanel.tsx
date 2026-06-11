import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import type { components } from "../api/types.gen";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Input } from "./ui/Input";
import { Separator } from "./ui/Separator";

/**
 * Stages that require the async run path (`?async=true`) because they may
 * take seconds or minutes. The chip rail uses this to enqueue a job rather
 * than blocking the request handler.
 */
const SLOW_STAGES = new Set(["ocr", "extract_illustrations"]);

type PageRecord = components["schemas"]["PageRecord"];
type PageConfigOverrides = components["schemas"]["PageConfigOverrides-Input"];
type PageStageState = components["schemas"]["PageStageState"];
// StageFieldsResponse was removed in I1 (the /pipeline/stages/{id}/fields route
// was retired; the replacement is GET /projects/{id}/pipeline, PipelineSnapshot).
// visibleFields is now empty — all config is driven through PageConfigOverrides.

// Boolean fields in PageConfigOverrides.
const BOOL_FIELDS = new Set<keyof PageConfigOverrides>([
  "skip_auto_deskew",
  "do_morph",
  "skip_denoise",
  "use_ocr_bbox_edge",
  "rotated_standard",
  "single_dimension_rescale",
]);

// Numeric fields and their step values.
const NUM_FIELDS: Partial<Record<keyof PageConfigOverrides, number>> = {
  threshold_level: 1,
  fuzzy_pct: 0.001,
  pixel_count_columns: 1,
  pixel_count_rows: 1,
  deskew_before_crop: 0.1,
  deskew_after_crop: 0.1,
};

interface Props {
  projectId: string;
  idx0: number;
  stageId: string | undefined;
  page: PageRecord | undefined;
  onApplied?: () => void;
  onRunComplete?: () => void;
}

export function StageControlsPanel({
  projectId,
  idx0,
  stageId,
  page,
  onApplied,
  onRunComplete,
}: Props) {
  const queryClient = useQueryClient();

  const [localOverrides, setLocalOverrides] = useState<PageConfigOverrides>(
    () => page?.config_overrides ?? {},
  );

  // The /pipeline/stages/{id}/fields route was removed in I1. Fields are now
  // driven entirely through PageConfigOverrides; visibleFields is always empty.
  const visibleFields: (keyof PageConfigOverrides)[] = [];

  const applyMutation = useMutation({
    mutationFn: () =>
      api.patch<PageRecord>(`/api/data/projects/${projectId}/pages/${idx0}`, {
        config_overrides: localOverrides,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["page", projectId, idx0],
      });
      onApplied?.();
    },
  });

  const isSlowStage = stageId != null && SLOW_STAGES.has(stageId);

  const runMutation = useMutation({
    mutationFn: () => {
      const url = isSlowStage
        ? `/api/data/projects/${projectId}/pages/${idx0}/stages/${stageId}/run?async=true`
        : `/api/data/projects/${projectId}/pages/${idx0}/stages/${stageId}/run`;
      return api.post<PageStageState>(url, {});
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["page-stages", projectId, idx0],
      });
      onRunComplete?.();
    },
  });

  if (!stageId) return null;

  return (
    <div
      data-testid="stage-controls-panel"
      className="space-y-2 rounded border bg-surface p-3 text-sm"
    >
      <h2 className="text-sm font-semibold">
        Controls — <span className="font-mono text-ink-2">{stageId}</span>
      </h2>

      <Card className="p-4">
        {visibleFields.length === 0 && (
          <p className="text-xs text-ink-4">No config fields for this stage.</p>
        )}

        <div className="space-y-2">
          {visibleFields.map((field) => {
            const f = field;
            if (BOOL_FIELDS.has(f)) {
              return (
                <ToggleField
                  key={f}
                  field={f}
                  value={
                    (localOverrides[f] as boolean | null | undefined) ?? null
                  }
                  onChange={(v) =>
                    setLocalOverrides((prev) => ({ ...prev, [f]: v }))
                  }
                />
              );
            }
            if (f in NUM_FIELDS) {
              return (
                <NumField
                  key={f}
                  field={f}
                  {...(NUM_FIELDS[f] !== undefined && { step: NUM_FIELDS[f] })}
                  value={
                    (localOverrides[f] as number | null | undefined) ?? null
                  }
                  onChange={(v) =>
                    setLocalOverrides((prev) => ({ ...prev, [f]: v }))
                  }
                />
              );
            }
            return null;
          })}
        </div>
      </Card>

      <Separator />

      <Card className="p-4">
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="xs"
            onClick={() => applyMutation.mutate()}
            disabled={applyMutation.isPending}
          >
            {applyMutation.isPending ? "Applying…" : "Apply"}
          </Button>
          <Button
            variant="secondary"
            size="xs"
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending || !stageId}
          >
            {runMutation.isPending ? "Running…" : "Run this stage"}
          </Button>
        </div>

        {applyMutation.isError && (
          <p className="text-xs text-red-600 mt-1">Apply failed.</p>
        )}
        {runMutation.isError && (
          <p className="text-xs text-red-600 mt-1">Run failed.</p>
        )}
      </Card>
    </div>
  );
}

function NumField({
  field,
  step,
  value,
  onChange,
}: {
  field: string;
  step?: number;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs text-ink-2">{field}</span>
      <Input
        data-testid={`field-${field}`}
        type="number"
        step={step}
        value={value ?? ""}
        placeholder="inherit"
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === "" ? null : Number(raw));
        }}
        className="mt-1"
      />
    </label>
  );
}

function ToggleField({
  field,
  value,
  onChange,
}: {
  field: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
}) {
  const next =
    value === null || value === undefined ? true : value ? false : null;
  return (
    <button
      type="button"
      data-testid={`field-${field}`}
      onClick={() => onChange(next)}
      className={`w-full rounded border px-2 py-1 text-left text-xs ${
        value === true
          ? "border-emerald-500 bg-emerald-50 text-emerald-800"
          : value === false
            ? "border-rose-500 bg-rose-50 text-rose-800"
            : "border-border-2 bg-surface text-ink-3"
      }`}
    >
      <div className="font-medium">{field}</div>
      <div className="text-[10px]">
        {value === null ? "inherit" : value ? "on" : "off"}
      </div>
    </button>
  );
}
