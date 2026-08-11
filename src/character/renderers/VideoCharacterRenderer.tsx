/**
 * Renderer for a user-supplied transparent video set.
 *
 * This is the path to a photorealistic AURA. Drop one alpha-channel WebM per
 * state into `%APPDATA%\com.aura.companion\characters\` and switch the renderer
 * in Settings — no code changes. See README → "Supplying a character asset".
 *
 * States without a file fall back to `idle.webm`, so a two-clip set already
 * works and can be filled in over time.
 */

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";

import { CHARACTER_STATES } from "../types";
import type {
  CharacterAssetStatus,
  CharacterRenderProps,
  CharacterRenderer,
  CharacterState,
} from "../types";

const ASSET_DIR = "characters";

const fileFor = (state: CharacterState) => `${state.toLowerCase()}.webm`;

async function resolveUrl(file: string): Promise<string> {
  const dir = await appDataDir();
  const path = await join(dir, ASSET_DIR, file);
  return convertFileSrc(path);
}

/** Probe by loading metadata — cheap, and needs no filesystem permission. */
function canLoad(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = document.createElement("video");
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      probe.removeAttribute("src");
      probe.load();
      resolve(ok);
    };
    probe.preload = "metadata";
    probe.muted = true;
    probe.onloadedmetadata = () => finish(true);
    probe.onerror = () => finish(false);
    // Never let a missing file hang the renderer swap.
    setTimeout(() => finish(false), 3000);
    probe.src = url;
  });
}

const VideoCharacter = memo(function VideoCharacter({
  pose,
  width,
  height,
}: CharacterRenderProps) {
  const [sources, setSources] = useState<Partial<Record<CharacterState, string>>>({});
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        CHARACTER_STATES.map(async (state) => {
          const url = await resolveUrl(fileFor(state));
          return [state, (await canLoad(url)) ? url : undefined] as const;
        }),
      );
      if (cancelled) return;
      const map: Partial<Record<CharacterState, string>> = {};
      for (const [state, url] of entries) if (url) map[state] = url;
      setSources(map);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const src = useMemo(
    () => sources[pose.state] ?? sources.IDLE,
    [sources, pose.state],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    // Restart on state change so each clip reads as a deliberate beat.
    video.currentTime = 0;
    void video.play().catch(() => {
      /* autoplay of a muted video should not fail, but never crash if it does */
    });
  }, [src]);

  if (!src) {
    return (
      <div className="character-render character-render--missing" style={{ width, height }}>
        <p>No character clips found.</p>
        <p className="hint">
          Add <code>idle.webm</code> to the <code>characters</code> folder in AURA&apos;s
          app data directory, or switch back to the vector renderer in Settings.
        </p>
      </div>
    );
  }

  return (
    <div
      className="character-render character-render--video"
      style={{ width, height }}
      data-state={pose.state}
    >
      <video
        ref={videoRef}
        src={src}
        width={width}
        height={height}
        autoPlay
        loop
        muted
        playsInline
      />
    </div>
  );
});

export const videoRenderer: CharacterRenderer = {
  id: "video",
  displayName: "AURA — Video (your asset)",
  description:
    "Plays transparent WebM clips you supply, one per state. Use this for a photorealistic character.",
  probeAssets: async (): Promise<CharacterAssetStatus> => {
    try {
      const idle = await resolveUrl(fileFor("IDLE"));
      const available = await canLoad(idle);
      return {
        available,
        detail: available
          ? "Found idle.webm in the characters folder."
          : "No idle.webm found in the characters folder.",
      };
    } catch (e) {
      return { available: false, detail: `Could not read the characters folder: ${e}` };
    }
  },
  Component: VideoCharacter,
};
