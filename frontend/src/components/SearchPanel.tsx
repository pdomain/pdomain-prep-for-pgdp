/**
 * SearchPanel — full-text search across OCR pages for a project.
 *
 * - Calls GET /api/data/projects/{id}/search?q=...&limit=20&offset=...
 * - Renders a result list with page label, snippet (FTS5 <b> → <mark>),
 *   and relevance score.
 * - Clicking a result navigates to /projects/:id/pages/:idx0.
 * - Next/Previous pagination via limit + offset query params.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { components } from "../api/types.gen";

type SearchHitResponse = components["schemas"]["SearchHitResponse"];
type SearchResponse = components["schemas"]["SearchResponse"];

const PAGE_LIMIT = 20;

/**
 * Parse FTS5 snippet HTML (only <b>…</b> bold tags) into an array of
 * React nodes where each <b> segment becomes a <mark> element.
 * Safe — no dangerouslySetInnerHTML; FTS5 only emits <b> wrappers.
 */
function SnippetHtml({ raw }: { raw: string }) {
  const parts: React.ReactNode[] = [];
  // Split on <b>…</b> pairs.
  const re = /<b>(.*?)<\/b>/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(raw)) !== null) {
    if (match.index > last) {
      parts.push(raw.slice(last, match.index));
    }
    parts.push(<mark key={key++}>{match[1]}</mark>);
    last = match.index + match[0].length;
  }
  if (last < raw.length) {
    parts.push(raw.slice(last));
  }
  return <span>{parts}</span>;
}

interface Props {
  projectId: string;
}

export function SearchPanel({ projectId }: Props) {
  const [query, setQuery] = useState("");
  const [committed, setCommitted] = useState("");
  const [offset, setOffset] = useState(0);

  const search = useQuery<SearchResponse>({
    queryKey: ["search", projectId, committed, offset],
    queryFn: () =>
      api.get<SearchResponse>(
        `/api/data/projects/${projectId}/search?q=${encodeURIComponent(committed)}&limit=${PAGE_LIMIT}&offset=${offset}`,
      ),
    enabled: committed.trim().length > 0,
  });

  function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setOffset(0);
    setCommitted(query.trim());
  }

  const results: SearchHitResponse[] = search.data?.results ?? [];
  const totalCount: number = search.data?.total_count ?? 0;
  const hasMore = offset + PAGE_LIMIT < totalCount;
  const hasPrev = offset > 0;

  return (
    <div className="rounded border bg-white" data-testid="search-panel">
      <div className="px-4 pt-3 pb-2 text-sm font-medium">Search pages</div>

      <form
        onSubmit={handleSubmit}
        className="flex gap-2 px-4 pb-3"
        role="search"
      >
        <input
          type="search"
          aria-label="Search query"
          placeholder="Search OCR text…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
        />
        <button
          type="submit"
          className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
        >
          Search
        </button>
      </form>

      {search.isLoading && (
        <p className="px-4 pb-3 text-xs text-slate-500">Searching…</p>
      )}

      {search.isError && (
        <p className="px-4 pb-3 text-xs text-rose-600">Search failed.</p>
      )}

      {!search.isLoading &&
        committed &&
        results.length === 0 &&
        !search.isError && (
          <p className="px-4 pb-3 text-xs text-slate-500">No results.</p>
        )}

      {results.length > 0 && (
        <>
          <p className="px-4 pb-1 text-xs text-slate-400">
            {totalCount} result{totalCount !== 1 ? "s" : ""}
          </p>
          <ul className="divide-y" data-testid="search-results">
            {results.map((hit) => (
              <li key={hit.page_id} className="px-4 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <Link
                    to={`/projects/${projectId}/pages/${hit.idx0}`}
                    className="text-sm font-medium text-slate-800 hover:text-sky-700 hover:underline"
                    data-testid={`result-link-${hit.idx0}`}
                  >
                    Page {hit.idx0 + 1}
                  </Link>
                  <span className="text-[10px] text-slate-400">
                    score {hit.score.toFixed(2)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-600">
                  <SnippetHtml raw={hit.snippet} />
                </p>
              </li>
            ))}
          </ul>

          {(hasPrev || hasMore) && (
            <div className="flex gap-2 px-4 py-2">
              <button
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_LIMIT))}
                disabled={!hasPrev}
                className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50 disabled:opacity-40"
              >
                Previous 20
              </button>
              <button
                onClick={() => setOffset((o) => o + PAGE_LIMIT)}
                disabled={!hasMore}
                className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50 disabled:opacity-40"
              >
                Next 20
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
