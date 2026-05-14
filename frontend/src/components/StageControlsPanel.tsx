import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import type { components } from "../api/types.gen";

/**
 * Stages that require the async run path (`?async=true`) because they may
 * take seconds or minutes. The chip rail uses this to enqueue a job rather
 * than blocking the request handler.
 */
const SLOW_STAGES = new Set(["ocr", "extract_illustrations"]);

type PageRecord = components["schemas"]["PageRecord"];
type PageConfigOverrides = components["schemas"]["PageConfigOverrides-Input"];
type PageStageState = components["schemas"]["PageStageState"];
type StageFieldsResponse = components["schemas"]["StageFieldsResponse"];

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

  const fields = useQuery<StageFieldsResponse>({
    queryKey: ["stage-fields", stageId],
    queryFn: () =>
      api.get<StageFieldsResponse>(
        `/api/data/pipeline/stages/${stageId}/fields`,
      ),
    enabled: !!stageId,
  });

  const applyMutation = useMutation({
    mutationFn: () =>
      api.patch<PageRecord>(`/api/data/projects/${projectId}/pages/${idx0}`, {
        config_overrides: localOverrides,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["page", projectId, idx0] });
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
      queryClient.invalidateQueries({
        queryKey: ["stages", projectId, idx0],
      });
      onRunComplete?.();
    },
  });

  if (!stageId) return null;

  const visibleFields = fields.data?.fields ?? [];

  return (
    <div
      data-testid="stage-controls-panel"
      className="space-y-2 rounded border bg-white p-3 text-sm"
    >
      <h2 className="text-sm font-semibold">
        Controls — <span className="font-mono text-slate-600">{stageId}</span>
      </h2>

      {fields.isLoading && (
        <p className="text-xs text-slate-400">Loading fields…</p>
      )}

      {visibleFields.length === 0 && !fields.isLoading && (
        <p className="text-xs text-slate-400">
          No config fields for this stage.
        </p>
      )}

      {visibleFields.map((field) => {
        const f = field as keyof PageConfigOverrides;
        if (BOOL_FIELDS.has(f)) {
          return (
            <ToggleField
              key={f}
              field={f}
              value={(localOverrides[f] as boolean | null | undefined) ?? null}
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
              step={NUM_FIELDS[f]}
              value={(localOverrides[f] as number | null | undefined) ?? null}
              onChange={(v) =>
                setLocalOverrides((prev) => ({ ...prev, [f]: v }))
              }
            />
          );
        }
        return null;
      })}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => applyMutation.mutate()}
          disabled={applyMutation.isPending}
          className="rounded bg-slate-900 px-3 py-1.5 text-xs text-white disabled:opacity-50 hover:bg-slate-800"
        >
          {applyMutation.isPending ? "Applying…" : "Apply"}
        </button>
        <button
          onClick={() => runMutation.mutate()}
          disabled={runMutation.isPending || !stageId}
          className="rounded border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
        >
          {runMutation.isPending ? "Running…" : "Run this stage"}
        </button>
      </div>

      {applyMutation.isError && (
        <p className="text-xs text-red-600">Apply failed.</p>
      )}
      {runMutation.isError && (
        <p className="text-xs text-red-600">Run failed.</p>
      )}
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
      <span className="text-xs text-slate-600">{field}</span>
      <input
        data-testid={`field-${field}`}
        type="number"
        step={step}
        value={value ?? ""}
        placeholder="inherit"
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === "" ? null : Number(raw));
        }}
        className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
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
            : "border-slate-300 bg-white text-slate-500"
      }`}
    >
      <div className="font-medium">{field}</div>
      <div className="text-[10px]">
        {value === null ? "inherit" : value ? "on" : "off"}
      </div>
    </button>
  );
}
