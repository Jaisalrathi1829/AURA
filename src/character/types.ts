/**
 * Character abstraction layer.
 *
 * Nothing outside `src/character` knows how AURA is drawn. The rest of the app
 * sets a {@link CharacterState}; a controller turns that into a {@link CharacterPose}
 * every frame; a {@link CharacterRenderer} draws the pose however it likes.
 *
 * Swapping in a different animation technology — Live2D, Rive, a 3D model, a
 * transparent video set — means writing one renderer and registering it. No
 * other file changes.
 */

import type { ComponentType } from "react";
import type { RendererId } from "@/types";

export const CHARACTER_STATES = [
  "IDLE",
  "LISTENING",
  "THINKING",
  "TALKING",
  "HAPPY",
  "CURIOUS",
  "CONFUSED",
  "SERIOUS",
  "SLEEPING",
] as const;

export type CharacterState = (typeof CHARACTER_STATES)[number];

/**
 * Expression is separable from state: AURA can be TALKING while amused, or
 * LISTENING while serious.
 */
export const CHARACTER_EXPRESSIONS = [
  "NEUTRAL",
  "WARM",
  "AMUSED",
  "CURIOUS",
  "PUZZLED",
  "FOCUSED",
  "SOFT",
] as const;

export type CharacterExpression = (typeof CHARACTER_EXPRESSIONS)[number];

/**
 * One frame of animation, fully resolved. All values are normalised so a
 * renderer never has to know pixel sizes.
 */
export interface CharacterPose {
  state: CharacterState;
  expression: CharacterExpression;
  /** 0 = eyes open, 1 = fully closed. */
  blink: number;
  /** Gaze offset, -1 (left/up) .. 1 (right/down). */
  gazeX: number;
  gazeY: number;
  /** Head rotation, -1 .. 1. */
  headYaw: number;
  headTilt: number;
  /** Breathing, -1 .. 1 (inhale positive). */
  breath: number;
  /** Mouth openness, 0 .. 1. */
  mouth: number;
  /** Smile amount, 0 .. 1. */
  smile: number;
  /** Brow position: -1 furrowed, 0 neutral, 1 raised. */
  brow: number;
  /** Lateral body sway, -1 .. 1. */
  sway: number;
  /** Overall luminance of the ambient aura, 0 .. 1. */
  glow: number;
}

export interface CharacterRenderProps {
  pose: CharacterPose;
  width: number;
  height: number;
  /** User's animation-intensity setting, 0 .. 1. */
  intensity: number;
}

/**
 * A concrete way of drawing AURA.
 *
 * `probeAssets` reports whether the renderer can actually run — the video
 * renderer needs files the user supplies, so the app can fall back gracefully
 * instead of showing an empty window.
 */
export interface CharacterRenderer {
  id: RendererId;
  displayName: string;
  /** Shown in Settings so the trade-off is explicit. */
  description: string;
  probeAssets: () => Promise<CharacterAssetStatus>;
  Component: ComponentType<CharacterRenderProps>;
}

export interface CharacterAssetStatus {
  available: boolean;
  /** Human-readable explanation when unavailable. */
  detail: string;
}

/** Describes an asset a renderer needs, for documentation and diagnostics. */
export interface CharacterAsset {
  state: CharacterState;
  /** Resolved URL the renderer will load. */
  src: string;
}

export const DEFAULT_POSE: CharacterPose = {
  state: "IDLE",
  expression: "NEUTRAL",
  blink: 0,
  gazeX: 0,
  gazeY: 0,
  headYaw: 0,
  headTilt: 0,
  breath: 0,
  mouth: 0,
  smile: 0,
  brow: 0,
  sway: 0,
  glow: 0.5,
};
