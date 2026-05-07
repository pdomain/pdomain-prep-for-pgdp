/**
 * Thumbnail-strip preview of an uploaded source.zip.
 *
 * Renders right after a project's zip is uploaded (the create-project flow
 * navigates to ProjectConfigurePage, which shows the ingest-in-flight banner;
 * this strip lives inside that banner) so the user can sanity-check that the
 * right zip landed before unzip + thumbnail jobs finish.
 *
 * Backend pieces (roadmap §8 / P2 #8):
 *   - slice 2 — `GET /api/data/projects/{id}/source-preview?limit=N`
 *     returns `{ filenames, total_image_count }`, reading only the zip
 *     central directory (no payload decompression).
 *   - slice 3 — `GET /.../source-preview/{filename}/thumbnail` returns a
 *     JPEG blob for one entry. We point an `<img>` at it directly so the
 *     browser's normal image-loading pipeline handles caching.
 *
 * The component is read-only, has no mutations, and is safe to mount even
 * when the source.zip is still being PUT (404 → friendly placeholder).
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { components } from "../api/types.gen";

// First consumer migrated to the generated openapi spec (P4 #20). The
// hand-written `types.ts` keeps an identical alias for the remaining
// consumers; both shapes are byte-equal so a future big-bang swap is
// purely mechanical. Aliasing locally keeps the component body unchanged.
type SourcePreviewResponse = components["schemas"]["SourcePreviewResponse"];

interface SourcePreviewProps {
  projectId: string;
  /** Defaults to 10 — the spec describes "first ~10 page images". */
  limit?: number;
}

export function SourcePreview({ projectId, limit = 10 }: SourcePreviewProps) {
  const preview = useQuery({
    queryKey: ["source-preview", projectId, limit],
    queryFn: () =>
      api.get<SourcePreviewResponse>(
        `/api/data/projects/${projectId}/source-preview?limit=${limit}`,
      ),
    // Don't auto-retry the 404-while-uploading case — the friendly
    // placeholder below is the right UX, and noisy retries would just
    // spam the console.
    retry: false,
  });

  if (preview.isLoading) {
    return (
      <div className="text-xs text-slate-500" role="status">
        Loading preview…
      </div>
    );
  }

  if (preview.error) {
    // The most common failure during a fresh upload is the 404
    // "source zip not uploaded" race — show a calmer message than
    // the raw error string.
    return (
      <div className="text-xs text-slate-500">
        Source zip is not yet available for preview.
      </div>
    );
  }

  const data = preview.data;
  if (!data || data.filenames.length === 0) {
    return (
      <div className="text-xs text-slate-500">
        Source zip contains no recognised images.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-slate-600">
        Showing {data.filenames.length} of {data.total_image_count}
      </div>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-10">
        {data.filenames.map((name) => (
          <li
            key={name}
            className="flex flex-col gap-1 overflow-hidden rounded border border-slate-200 bg-white"
          >
            <div className="aspect-[2/3] w-full overflow-hidden bg-slate-100">
              <img
                // encodeURIComponent escapes "/" (→ %2F) and " " (→ %20),
                // matching FastAPI's `{filename}` path-parameter decoding.
                src={`/api/data/projects/${projectId}/source-preview/${encodeURIComponent(
                  name,
                )}/thumbnail`}
                alt={name}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </div>
            <div
              className="truncate px-1 pb-1 font-mono text-[10px] text-slate-600"
              title={name}
            >
              {name}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
