import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import JSZip from "jszip";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { components } from "../api/types.gen";
import { FormErrorBanner } from "../components/FormErrorBanner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "../components/ui/AlertDialog";
import { Badge, type BadgeStatus } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/Dialog";
import { Input } from "../components/ui/Input";
import { PageHeader } from "../components/shell/PageHeader";

type CreateProjectRequest = components["schemas"]["CreateProjectRequest"];
type CreateProjectResponse = components["schemas"]["CreateProjectResponse"];
type Project = components["schemas"]["Project"];
type ProjectStatus = components["schemas"]["ProjectStatus"];

/** Map project status → Badge status variant */
function toBadgeStatus(status: ProjectStatus): BadgeStatus {
  switch (status) {
    case "ingesting":
      return "running";
    case "configuring":
      return "queued";
    case "processing":
      return "running";
    case "reviewing":
      return "awaiting_review";
    case "packaging":
      return "scheduled";
    case "complete":
      return "complete";
    default:
      return "queued";
  }
}

function formattedDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function ProjectListPage() {
  const [showCreate, setShowCreate] = useState(false);
  const navigate = useNavigate();
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get<Project[]>("/api/data/projects"),
  });

  return (
    <section className="flex flex-col">
      <PageHeader
        title="Projects"
        actions={
          <Button onClick={() => setShowCreate(true)}>New project</Button>
        }
      />

      <div className="px-6 pb-6 space-y-4">
        {projects.isLoading && <p className="text-ink-3">Loading…</p>}
        {projects.error && (
          <p className="text-status-error">
            Error loading projects: {(projects.error as Error).message}
          </p>
        )}

        {projects.data && projects.data.length === 0 && (
          <Card
            data-testid="empty-state"
            className="flex flex-col items-center gap-4 border-dashed border-border-2 p-12 text-center"
          >
            <p className="text-ink-3">No projects yet.</p>
            <Button onClick={() => setShowCreate(true)}>New project</Button>
          </Card>
        )}

        {projects.data && projects.data.length > 0 && (
          <div
            data-testid="project-grid"
            className="grid grid-cols-1 gap-4 lg:grid-cols-2"
          >
            {projects.data.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                onOpen={() => navigate(`/projects/${p.id}`)}
              />
            ))}
          </div>
        )}
      </div>

      <CreateProjectModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
      />
    </section>
  );
}

function ProjectCard({
  project,
  onOpen,
}: {
  project: Project;
  onOpen: () => void;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const del = useMutation({
    mutationFn: () => api.delete(`/api/data/projects/${project.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  return (
    <>
      <Card className="p-4 flex flex-col gap-3">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-semibold text-ink-1">{project.name}</h2>
            <p className="text-xs text-ink-3 font-mono mt-0.5">
              {project.page_count} pages · {formattedDate(project.updated_at)}
            </p>
          </div>
          <Badge status={toBadgeStatus(project.status as ProjectStatus)} />
        </div>
        <div className="flex items-center justify-between">
          <button
            onClick={(e) => {
              e.preventDefault();
              setConfirming(true);
            }}
            className="rounded px-2 py-1 text-ink-3 hover:bg-bg-raised hover:text-status-error text-sm"
            aria-label="Delete project"
            title="Delete project"
          >
            ⋯
          </button>
          <Button variant="outline" size="sm" onClick={onOpen}>
            Open
          </Button>
        </div>
      </Card>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogTitle className="text-lg font-semibold">
            Delete project?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-ink-3">
            This will permanently remove{" "}
            <span className="font-medium text-ink-1">{project.name}</span> and
            its uploaded scans. This action cannot be undone.
          </AlertDialogDescription>
          <div className="flex justify-end gap-2 pt-2">
            <AlertDialogCancel className="rounded border border-border-2 px-3 py-1.5 text-sm hover:bg-bg-raised">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => del.mutate()}
              disabled={del.isPending}
              className="rounded bg-status-error px-3 py-1.5 text-sm text-white hover:bg-status-error/90 disabled:opacity-50"
            >
              Delete
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

type Step =
  | { kind: "form" }
  | { kind: "zipping" }
  | { kind: "uploading"; pct: number };

type UploadMode = "zip" | "folder";

function CreateProjectModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [folderFiles, setFolderFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<UploadMode>("zip");
  const [step, setStep] = useState<Step>({ kind: "form" });

  // Radix Dialog handles the a11y previously wired by hand:
  //   - role="dialog" with aria-labelledby auto-wired to the DialogTitle
  //     (Radix v1.1+ deliberately omits aria-modal because the focus
  //     trap is sufficient under the WAI-ARIA modal pattern)
  //   - Escape closes (no manual keydown listener)
  //   - Focus trap with initial focus on the first focusable child
  //   - Body scroll-lock while open (data-scroll-locked + injected styles
  //     via react-remove-scroll-bar)
  //   - Click-outside on the overlay closes
  // The cba526e a11y intent — discoverable modal + scroll-lock + Escape +
  // initial focus — still holds; the test contract was updated to match
  // Radix's mechanism (data-scroll-locked attribute instead of inline
  // body.style.overflow).

  const createMut = useMutation({
    mutationFn: async () => {
      // Determine the file to upload — either the selected zip or a
      // client-side zip built from the folder selection.
      let uploadFile_: File;
      if (mode === "folder") {
        if (folderFiles.length === 0)
          throw new Error("Select a folder of images first.");
        setStep({ kind: "zipping" });
        const zip = new JSZip();
        for (const f of folderFiles) {
          zip.file(f.name, f);
        }
        const blob = await zip.generateAsync({ type: "blob" });
        uploadFile_ = new File([blob], "upload.zip", {
          type: "application/zip",
        });
      } else {
        if (!file) throw new Error("Choose a zip file first.");
        uploadFile_ = file;
      }

      const created = await api.post<CreateProjectResponse>(
        "/api/data/projects",
        { name, source_type: "zip" } satisfies CreateProjectRequest,
      );
      if (!created.upload_url || !created.upload_key) {
        throw new Error("Server did not return an upload URL.");
      }

      // PUT the zip to /cdn/<key> (filesystem mode) or S3 (managed mode).
      setStep({ kind: "uploading", pct: 0 });
      await uploadFile(created.upload_url, uploadFile_, (pct) =>
        setStep({ kind: "uploading", pct }),
      );

      // Enqueue the unzip job. The handler will chain a thumbnails job
      // on success — both show up in the JobsPage we navigate to next.
      await api.post<{ job_id: string; status: string }>("/api/gpu/ingest", {
        project_id: created.project.id,
        source_key: created.upload_key,
        source_type: "zip",
      });

      return created.project;
    },
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      // Take the user to the JobsPage filtered to this project — they'll
      // watch unzip then thumbnails progress side-by-side.
      navigate(`/jobs?project_id=${encodeURIComponent(project.id)}`);
    },
    onError: () => {
      // Surface via the global sonner toast (FormErrorBanner below);
      // drop back to the form so the user can correct + retry.
      setStep({ kind: "form" });
    },
  });

  const isReady =
    name.trim().length > 0 &&
    (mode === "zip" ? file !== null : folderFiles.length > 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">New project</DialogTitle>

        {step.kind === "form" && (
          <>
            <label className="block">
              <span className="text-sm text-ink-2">Book name</span>
              <Input
                className="mt-1"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Belloc — The Four Men"
              />
            </label>

            {/* Mode toggle — ZIP file vs Folder */}
            <div
              role="tablist"
              aria-label="Upload source"
              className="flex gap-1 rounded border border-border-2 p-0.5 w-fit"
            >
              <button
                role="tab"
                aria-selected={mode === "zip"}
                onClick={() => {
                  setMode("zip");
                  setFolderFiles([]);
                }}
                className={`rounded px-3 py-1 text-sm transition-colors ${
                  mode === "zip"
                    ? "bg-accent text-white"
                    : "text-ink-2 hover:bg-bg-raised"
                }`}
              >
                ZIP file
              </button>
              <button
                role="tab"
                aria-selected={mode === "folder"}
                onClick={() => {
                  setMode("folder");
                  setFile(null);
                }}
                className={`rounded px-3 py-1 text-sm transition-colors ${
                  mode === "folder"
                    ? "bg-accent text-white"
                    : "text-ink-2 hover:bg-bg-raised"
                }`}
              >
                Folder
              </button>
            </div>

            {mode === "zip" && (
              <label className="block">
                <span className="text-sm text-ink-2">Source zip</span>
                <input
                  type="file"
                  accept=".zip,application/zip"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="mt-1 block w-full text-sm"
                />
              </label>
            )}

            {mode === "folder" && (
              <label className="block">
                <span className="text-sm text-ink-2">
                  Image folder{" "}
                  <span className="text-ink-3">(select your scans folder)</span>
                </span>
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  data-folder-input="true"
                  {...({ webkitdirectory: "" } as object)}
                  onChange={(e) => {
                    const files = e.target.files
                      ? Array.from(e.target.files)
                      : [];
                    setFolderFiles(files);
                  }}
                  className="mt-1 block w-full text-sm"
                />
                {folderFiles.length > 0 && (
                  <p className="mt-1 text-xs text-ink-3">
                    {folderFiles.length} image
                    {folderFiles.length !== 1 ? "s" : ""} selected — will be
                    zipped before upload
                  </p>
                )}
              </label>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => createMut.mutate()} disabled={!isReady}>
                Create + Upload
              </Button>
            </div>
          </>
        )}

        {step.kind === "zipping" && <ProgressLine label="Zipping…" pct={0} />}

        {step.kind === "uploading" && (
          <ProgressLine label={`Uploading… ${step.pct}%`} pct={step.pct} />
        )}

        <FormErrorBanner
          prefix="create project failed"
          error={createMut.isError ? (createMut.error as Error) : null}
        />
      </DialogContent>
    </Dialog>
  );
}

function ProgressLine({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="space-y-2">
      <div className="text-sm text-ink-2">{label}</div>
      <div className="h-2 w-full overflow-hidden rounded bg-bg-raised">
        <div
          className="h-full bg-accent transition-[width]"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

async function uploadFile(
  url: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<void> {
  // XHR is the only API with progress events in the browser.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed: HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("Upload network error"));
    xhr.send(file);
  });
}
