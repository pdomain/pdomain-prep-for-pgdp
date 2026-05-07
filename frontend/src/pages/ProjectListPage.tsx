import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { components } from "../api/types.gen";

type CreateProjectRequest = components["schemas"]["CreateProjectRequest"];
type CreateProjectResponse = components["schemas"]["CreateProjectResponse"];
type Project = components["schemas"]["Project"];

export function ProjectListPage() {
  const [showCreate, setShowCreate] = useState(false);
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get<Project[]>("/api/data/projects"),
  });

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Projects</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-800"
        >
          New project
        </button>
      </header>

      {projects.isLoading && <p className="text-slate-500">Loading…</p>}
      {projects.error && (
        <p className="text-red-600">
          Error loading projects: {(projects.error as Error).message}
        </p>
      )}

      {projects.data && projects.data.length === 0 && (
        <p className="rounded border border-dashed border-slate-300 bg-white p-6 text-center text-slate-500">
          No projects yet. Create one from a zip of scanned page images.
        </p>
      )}

      {projects.data && projects.data.length > 0 && (
        <ul className="divide-y rounded border bg-white">
          {projects.data.map((p) => (
            <ProjectListRow key={p.id} project={p} />
          ))}
        </ul>
      )}

      {showCreate && <CreateProjectModal onClose={() => setShowCreate(false)} />}
    </section>
  );
}

type Step =
  | { kind: "form" }
  | { kind: "uploading"; pct: number }
  | { kind: "error"; message: string };

function CreateProjectModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>({ kind: "form" });

  const createMut = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a zip file first.");
      const created = await api.post<CreateProjectResponse>(
        "/api/data/projects",
        { name, source_type: "zip" } satisfies CreateProjectRequest,
      );
      if (!created.upload_url || !created.upload_key) {
        throw new Error("Server did not return an upload URL.");
      }

      // PUT the zip to /cdn/<key> (filesystem mode) or S3 (managed mode).
      setStep({ kind: "uploading", pct: 0 });
      await uploadFile(created.upload_url, file, (pct) =>
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
    onError: (e) => {
      setStep({ kind: "error", message: (e as Error).message });
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md space-y-4 rounded-lg bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">New project</h2>

        {step.kind === "form" && (
          <>
            <label className="block">
              <span className="text-sm text-slate-700">Book name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm"
                placeholder="e.g. Belloc — The Four Men"
              />
            </label>

            <label className="block">
              <span className="text-sm text-slate-700">Source zip</span>
              <input
                type="file"
                accept=".zip,application/zip"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="mt-1 block w-full text-sm"
              />
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={onClose}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => createMut.mutate()}
                disabled={!name.trim() || !file}
                className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 hover:bg-slate-800"
              >
                Create + Upload
              </button>
            </div>
          </>
        )}

        {step.kind === "uploading" && (
          <ProgressLine label={`Uploading… ${step.pct}%`} pct={step.pct} />
        )}

        {step.kind === "error" && (
          <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            {step.message}
          </div>
        )}
      </div>
    </div>
  );
}

function ProgressLine({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="space-y-2">
      <div className="text-sm text-slate-700">{label}</div>
      <div className="h-2 w-full overflow-hidden rounded bg-slate-200">
        <div
          className="h-full bg-slate-900 transition-[width]"
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

function ProjectListRow({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const del = useMutation({
    mutationFn: () => api.delete(`/api/data/projects/${project.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  return (
    <li>
      <div className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
        <Link to={`/projects/${project.id}`} className="flex-1">
          <div className="font-medium">{project.name}</div>
          <div className="text-xs text-slate-500">
            {project.page_count} pages — status: {project.status}
          </div>
        </Link>

        {confirming ? (
          <div className="flex items-center gap-1 text-xs">
            <span className="text-slate-700">Delete project?</span>
            <button
              onClick={() => del.mutate()}
              disabled={del.isPending}
              className="rounded bg-rose-600 px-2 py-0.5 text-white hover:bg-rose-700 disabled:opacity-50"
            >
              Yes
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={(e) => {
              e.preventDefault();
              setConfirming(true);
            }}
            className="ml-3 rounded px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
            aria-label="Delete project"
            title="Delete project"
          >
            ⋯
          </button>
        )}
      </div>
    </li>
  );
}
