/**
 * Renderer registry.
 *
 * Adding a rendering technology means adding a `CharacterRenderer` here. Every
 * other part of the app selects one by id and never learns how it draws.
 */

import type { RendererId } from "@/types";
import type { CharacterRenderer } from "../types";
import { vectorRenderer } from "./VectorCharacterRenderer";
import { videoRenderer } from "./VideoCharacterRenderer";

export const RENDERERS: Record<RendererId, CharacterRenderer> = {
  vector: vectorRenderer,
  video: videoRenderer,
};

export const RENDERER_LIST: CharacterRenderer[] = [vectorRenderer, videoRenderer];

/** Always returns something drawable — the vector renderer is the safety net. */
export function resolveRenderer(id: RendererId): CharacterRenderer {
  return RENDERERS[id] ?? vectorRenderer;
}
