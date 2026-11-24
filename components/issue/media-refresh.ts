"use client";

import { useEffect, useRef, useState } from "react";
import { freshMediaSrc, MEDIA_RETRY_GAP_MS } from "@/lib/client/media-refresh";
import type { IssueDetail } from "@/lib/client/types";

const VIDEOS = ".gh-markdown video[src]";

function videoSrcs(detail: IssueDetail): string[] {
  const html = [detail.bodyHtml, ...detail.comments.map((c) => c.bodyHtml)].filter(Boolean).join("");
  // An inert document: nothing in it loads or runs.
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll("video[src]")].map((v) => v.getAttribute("src") ?? "");
}

/**
 * Keeps the videos of an issue's description and comments playable past the
 * life of their signed URLs (lib/client/media-refresh.ts). When a video under
 * the returned ref fails, the issue is rendered again, the video gets its new
 * URL and goes on from where it stopped. The element is patched in place: a
 * new `bodyHtml` in state would rebuild the HTML and reset every other video.
 * The ref is a callback: the element may appear after the first render (an
 * issue that reaches the cache later), and the listener must follow it.
 */
export function useMediaRefresh<T extends HTMLElement>(number: number, onFresh?: (detail: IssueDetail) => void) {
  const [root, setRoot] = useState<T | null>(null);
  const fresh = useRef(onFresh);
  fresh.current = onFresh;
  useEffect(() => {
    if (!root) return;
    let live = true;
    const tried = new WeakMap<HTMLVideoElement, number>();
    // Videos that fail together (same expiry) share one request.
    let pending: Promise<string[]> | null = null;
    const load = () =>
      (pending ??= fetch(`/api/issues/${number}?fresh=1`, { cache: "no-store" })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const detail = (await res.json()) as IssueDetail;
          // GitHub did not answer: the cached description has no new URLs, and must not replace the rendering.
          if (detail.source === "cache") throw new Error("GitHub unreachable");
          if (live) fresh.current?.(detail);
          return videoSrcs(detail);
        })
        .finally(() => {
          pending = null;
        }));

    const onError = (e: Event) => {
      const video = e.target;
      if (!(video instanceof HTMLVideoElement) || !video.matches(VIDEOS)) return;
      const now = Date.now();
      if (now - (tried.get(video) ?? -Infinity) < MEDIA_RETRY_GAP_MS) return;
      tried.set(video, now);
      const all = [...root.querySelectorAll<HTMLVideoElement>(VIDEOS)];
      const stale = video.getAttribute("src") ?? "";
      const at = video.currentTime;
      const playing = !video.paused && !video.ended;
      void load()
        .then((srcs) => {
          const next = freshMediaSrc(stale, all.indexOf(video), all.length, srcs);
          if (!live || !next || !video.isConnected || video.getAttribute("src") !== stale) return;
          video.addEventListener(
            "loadedmetadata",
            () => {
              if (at > 0) video.currentTime = at;
              if (playing) void video.play().catch(() => {});
            },
            { once: true },
          );
          video.setAttribute("src", next);
          video.load();
        })
        .catch(() => {
          /* offline or GitHub unreachable: the player keeps its error */
        });
    };
    // Media errors do not bubble: listen on the way down.
    root.addEventListener("error", onError, true);
    return () => {
      live = false;
      root.removeEventListener("error", onError, true);
    };
  }, [number, root]);
  return setRoot;
}
