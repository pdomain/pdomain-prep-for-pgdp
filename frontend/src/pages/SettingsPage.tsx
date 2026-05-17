import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { components } from "../api/types.gen";
import { Button, buttonVariants } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Separator } from "../components/ui/Separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/Select";
import { PageHeader } from "../components/shell/PageHeader";
import { cn } from "@/lib/utils";

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
      void queryClient.invalidateQueries({ queryKey: ["system-defaults"] });
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
      void queryClient.invalidateQueries({ queryKey: ["system-defaults"] });
    },
  });

  if (defaults.isLoading || !draft) {
    return <p className="text-ink-3">Loading…</p>;
  }
  if (defaults.error) {
    return (
      <p className="text-status-error">
        Couldn't load defaults: {defaults.error.message}
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
      <PageHeader
        title="Settings"
        description="Defaults applied to every project unless overridden per book or per page."
      />

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
          options={OCR_ENGINES}
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
          options={LAYOUT_DETECTORS}
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
          <span className="text-ink-2">
            Standard scannos (one per line, <code>word</code> TAB{" "}
            <code>replacement</code>)
          </span>
          <textarea
            value={scannosText}
            onChange={(e) => setScannosText(e.target.value)}
            className="mt-1 block w-full rounded border border-border-2 bg-bg-surface p-2 font-mono text-xs"
            rows={6}
            spellCheck={false}
          />
        </label>
        <label className="block text-sm">
          <span className="text-ink-2">
            Hyphenation-join allow-list (one prefix per line)
          </span>
          <textarea
            value={hyphenText}
            onChange={(e) => setHyphenText(e.target.value)}
            className="mt-1 block w-full rounded border border-border-2 bg-bg-surface p-2 font-mono text-xs"
            rows={4}
            spellCheck={false}
          />
        </label>
      </FieldSet>

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-border-1 bg-bg-surface px-0 py-3">
        <Button
          variant="primary"
          size="sm"
          onClick={commit}
          disabled={save.isPending}
        >
          {save.isPending ? "Saving…" : "Save defaults"}
        </Button>
        <a
          href="/api/data/system/defaults/export"
          className={buttonVariants({ variant: "secondary", size: "sm" })}
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
            void queryClient.invalidateQueries({
              queryKey: ["system-defaults"],
            });
          }}
        />
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            if (confirm("Reset all system defaults to the spec defaults?"))
              reset.mutate();
          }}
          disabled={reset.isPending}
        >
          {reset.isPending ? "Resetting…" : "Reset to spec defaults"}
        </Button>
        {save.isSuccess && <span className="text-sm text-ink-2">Saved.</span>}
        {save.isError && (
          <span className="text-sm text-status-error">
            {save.error.message}
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
    const m = /^(\S+)\s+(.+)$/.exec(line);
    if (!m) continue;
    // noUncheckedIndexedAccess: groups 1 and 2 are defined when regex matches
    out[m[1]!] = m[2]!.trim();
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
    <Card className="space-y-3 p-4">
      <div>
        <p className="text-sm font-semibold text-ink-1">{title}</p>
        <Separator className="mt-2" />
      </div>
      {children}
    </Card>
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
      <span className="text-ink-2">{label}</span>
      <Input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1"
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
      <span className="text-ink-2">{label}</span>
      <Input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1"
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
    <div className="block text-sm">
      <span className="text-ink-2">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          aria-label={label}
          className="mt-1 block w-full rounded border border-border-2 bg-bg-surface px-2 py-1 text-sm text-ink-1"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
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
    <label
      className={cn(
        buttonVariants({ variant: "secondary", size: "sm" }),
        "cursor-pointer",
      )}
    >
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
        <span className="ml-2 text-xs text-status-error">import: {error}</span>
      )}
    </label>
  );
}
