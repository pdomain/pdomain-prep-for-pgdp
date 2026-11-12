/**
 * useFallbackImage — load the first image that decodes from a list of URLs.
 *
 * The zone canvas prefers the post_transform_crop artifact and falls back to
 * the ingest thumbnail when that stage has no clean artifact (404).
 */

import { useEffect, useState } from "react";

export interface FallbackImage {
  /** The decoded image, or null while loading or when every URL failed. */
  image: HTMLImageElement | null;
  /** The URL being tried, or the one that loaded. */
  src: string | null;
  /** True when every URL failed. */
  failed: boolean;
}

export function useFallbackImage(urls: readonly string[]): FallbackImage {
  const key = urls.join("\n");
  const [state, setState] = useState<{
    key: string;
    index: number;
    image: HTMLImageElement | null;
  }>({ key, index: 0, image: null });

  // Reset when the URL list changes (render-time adjustment, not an effect).
  const current = state.key === key ? state : { key, index: 0, image: null };
  if (current !== state) setState(current);

  const src = urls[current.index] ?? null;

  useEffect(() => {
    if (src === null) return;
    let cancelled = false;
    const img = new window.Image();
    img.onload = () => {
      if (!cancelled)
        setState((s) => (s.key === key ? { ...s, image: img } : s));
    };
    img.onerror = () => {
      if (!cancelled)
        setState((s) => (s.key === key ? { ...s, index: s.index + 1 } : s));
    };
    img.src = src;
    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
    };
  }, [key, src]);

  return {
    image: current.image,
    src,
    failed: src === null,
  };
}
