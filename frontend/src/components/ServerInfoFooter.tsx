/**
 * ServerInfoFooter — surfaces the bound server URL for users who closed
 * their terminal (§L1 step 3). Belt-and-suspenders for local-mode UX.
 *
 * Fetches `GET /api/server-info` once on mount; renders the URL as a
 * selectable text node with a tiny copy-to-clipboard button. Renders
 * nothing while pending or on error — better empty than misleading,
 * since this surface is purely a recovery affordance.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";

interface ServerInfo {
  host: string;
  port: number;
  url: string;
}

export function ServerInfoFooter(): React.ReactElement | null {
  const [copied, setCopied] = useState(false);
  const { data } = useQuery({
    queryKey: ["server-info"],
    queryFn: () => api.get<ServerInfo>("/api/server-info"),
    // Bound URL doesn't change for the life of the process — fetch once,
    // never refetch. (`staleTime: Infinity` + no refetch triggers.)
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  if (!data) return null;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(data.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail on insecure contexts / jsdom — the URL
      // is still selectable in the DOM, so failing silently is fine.
    }
  };

  return (
    <footer className="border-t border-border-1 bg-bg-page py-2 text-center text-xs text-ink-4">
      <span>Server: </span>
      <span className="select-all font-mono text-ink-2">{data.url}</span>
      <button
        type="button"
        onClick={onCopy}
        className="ml-2 rounded px-1.5 py-0.5 text-ink-4 hover:bg-bg-raised hover:text-ink-2"
        aria-label="Copy server URL"
      >
        {copied ? "copied" : "copy"}
      </button>
    </footer>
  );
}
