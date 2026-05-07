import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { components } from "../api/types.gen";

// GET returns the *Output* schema (server populates every field, so they're
// all required). PUT/POST accept the *Input* schema where defaults remain
// optional. The page reads then echoes back, so the Output shape (a strict
// subtype of Input on the wire) is what we model in state.
type SystemDefaults = components["schemas"]["SystemDefaults-Output"];

const OCR_ENGINES = ["doctr", "tesseract"] as const;
const LAYOUT_DETECTORS = ["none", "contour", "pp-doclayout-plus-l"] as const;

export function SettingsPage() {
  const queryClient = useQueryClient();
  const defaults = useQuery({
    queryKey: ["system-defaults"],
    queryFn: () => api.get<SystemDefaults>("/api/data/system/defaults"),
  });

  const [draft, setDraft] = useState<SystemDefaults | null>(null);
  const [scannosText, setScannosText] = useState("");
  const [hyphenText, setHyphenText] = useState("");

  useEffect(() => {
    if (defaults.data) {
      setDraft(defaults.data);
      setScannosText(
        Object.entries(defaults.data.standard_scannos)
          .map(([k, v]) => `${k}\t${v}`)
          .join("\n"),
      );
      setHyphenText(defaults.data.hyphenation_join_list.join("\n"));
    }
  }, [defaults.data]);

  const save = useMutation({
    mutationFn: (next: SystemDefaults) =>
      api.put<SystemDefaults>("/api/data/system/defaults", next),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system-defaults"] });
    },
  });

  const reset = useMutation({
    mutationFn: () => api.delete<SystemDefaults>("/api/data/system/defaults"),
    onSuccess: (d) => {
      setDraft(d);
      setScannosText(
        Object.entries(d.standard_scannos)
          .map(([k, v]) => `${k}\t${v}`)
          .join("\n"),
      );
      setHyphenText(d.hyphenation_join_list.join("\n"));
      queryClient.invalidateQueries({ queryKey: ["system-defaults"] });
    },
  });

  if (defaults.isLoading || !draft) {
    return <p className="text-slate-500">Loading…</p>;
  }
  if (defaults.error) {
    return (
      <p className="text-red-600">
        Couldn't load defaults: {(defaults.error as Error).message}
      </p>
    );
  }

  function patch<K extends keyof SystemDefaults>(k: K, v: SystemDefaults[K]) {
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  }

  function commit() {
    if (!draft) return;
    const scannos = parseScannos(scannosText);
    const hyphen = hyphenText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    save.mutate({
      ...draft,
      standard_scannos: scannos,
      hyphenation_join_list: hyphen,
    });
  }

  return (
    <section className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-slate-500">
          Defaults applied to every project unless overridden per book or per
          page.
        </p>
      </header>

      <FieldSet title="Image processing">
        <NumField
          label="Text threshold (Otsu fallback)"
          value={draft.text_threshold}
          onChange={(v) => patch("text_threshold", v)}
        />
        <NumField
          label="Page aspect (height ÷ width)"
          step={0.01}
          value={draft.page_h_w_ratio}
          onChange={(v) => patch("page_h_w_ratio", v)}
        />
        <NumField
          label="Fuzzy %"
          step={0.001}
          value={draft.default_fuzzy_pct}
          onChange={(v) => patch("default_fuzzy_pct", v)}
        />
        <NumField
          label="Pixel-count cols"
          value={draft.default_pixel_count_columns}
          onChange={(v) => patch("default_pixel_count_columns", v)}
        />
        <NumField
          label="Pixel-count rows"
          value={draft.default_pixel_count_rows}
          onChange={(v) => patch("default_pixel_count_rows", v)}
        />
      </FieldSet>

      <FieldSet title="OCR">
        <SelectField
          label="Engine"
          value={draft.ocr_engine}
          options={OCR_ENGINES as readonly string[]}
          onChange={(v) =>
            patch("ocr_engine", v as SystemDefaults["ocr_engine"])
          }
        />
        <TextField
          label="DocTR model key"
          value={draft.ocr_model_key ?? ""}
          onChange={(v) => patch("ocr_model_key", v || null)}
          placeholder="leave blank for the default fine-tuned model"
        />
        <NumField
          label="Tesseract DPI"
          value={draft.ocr_dpi}
          onChange={(v) => patch("ocr_dpi", v)}
        />
        <NumField
          label="OCR-bbox edge: minimum words"
          value={draft.ocr_bbox_edge_min_words}
          onChange={(v) => patch("ocr_bbox_edge_min_words", v)}
        />
      </FieldSet>

      <FieldSet title="Layout detector">
        <SelectField
          label="Detector"
          value={draft.layout_detector}
          options={LAYOUT_DETECTORS as readonly string[]}
          onChange={(v) =>
            patch("layout_detector", v as SystemDefaults["layout_detector"])
          }
        />
        <NumField
          label="Confidence threshold"
          step={0.05}
          value={draft.layout_detector_confidence}
          onChange={(v) => patch("layout_detector_confidence", v)}
        />
        <TextField
          label="Layout checkpoint (HF repo or local path)"
          value={draft.layout_checkpoint ?? ""}
          onChange={(v) => patch("layout_checkpoint", v || null)}
          placeholder="(use the default PP-DocLayout-plus-L)"
        />
      </FieldSet>

      <FieldSet title="Text post-processing">
        <label className="block text-sm">
          <span className="text-slate-700">
            Standard scannos (one per line, <code>word</code> TAB{" "}
            <code>replacement</code>)
          </span>
          <textarea
            value={scannosText}
            onChange={(e) => setScannosText(e.target.value)}
            className="mt-1 block w-full rounded border border-slate-300 p-2 font-mono text-xs"
            rows={6}
            spellCheck={false}
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-700">
            Hyphenation-join allow-list (one prefix per line)
          </span>
          <textarea
            value={hyphenText}
            onChange={(e) => setHyphenText(e.target.value)}
            className="mt-1 block w-full rounded border border-slate-300 p-2 font-mono text-xs"
            rows={4}
            spellCheck={false}
          />
        </label>
      </FieldSet>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={commit}
          disabled={save.isPending}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 hover:bg-slate-800"
        >
          {save.isPending ? "Saving…" : "Save defaults"}
        </button>
        <a
          href="/api/data/system/defaults/export"
          className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          download="pgdp-prep-defaults.json"
        >
          Export
        </a>
        <ImportButton
          onImported={(d) => {
            setDraft(d);
            setScannosText(
              Object.entries(d.standard_scannos)
                .map(([k, v]) => `${k}\t${v}`)
                .join("\n"),
            );
            setHyphenText(d.hyphenation_join_list.join("\n"));
            queryClient.invalidateQueries({ queryKey: ["system-defaults"] });
          }}
        />
        <button
          onClick={() => {
            if (confirm("Reset all system defaults to the spec defaults?"))
              reset.mutate();
          }}
          disabled={reset.isPending}
          className="rounded border border-rose-300 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
        >
          {reset.isPending ? "Resetting…" : "Reset to spec defaults"}
        </button>
        {save.isSuccess && (
          <span className="text-sm text-emerald-700">Saved.</span>
        )}
        {save.isError && (
          <span className="text-sm text-red-600">
            {(save.error as Error).message}
          </span>
        )}
      </div>
    </section>
  );
}

function parseScannos(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    // Accept either tab- or whitespace-separated.
    const m = line.match(/^(\S+)\s+(.+)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim();
  }
  return out;
}

// ─── Small layout primitives ────────────────────────────────────────────────

function FieldSet({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="space-y-3 rounded border bg-white p-4">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

function NumField({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="text-slate-700">{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
      />
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-slate-700">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="text-slate-700">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function ImportButton({
  onImported,
}: {
  onImported: (d: SystemDefaults) => void;
}) {
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File): Promise<void> {
    setError(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const r = await api.post<SystemDefaults>(
        "/api/data/system/defaults/import",
        parsed,
      );
      onImported(r);
    } catch (e) {
      setError((e as Error).message ?? "import failed");
    }
  }

  return (
    <label className="cursor-pointer rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
      Import…
      <input
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = ""; // allow re-selecting the same file
          if (f) void handleFile(f);
        }}
      />
      {error && (
        <span className="ml-2 text-xs text-rose-600">import: {error}</span>
      )}
    </label>
  );
}
