/**
 * Hosts the active renderer and owns the animation loop's DOM target.
 *
 * The stage element is where `CharacterAnimation` writes its custom properties,
 * so it must stay mounted for the life of the overlay — swapping renderers
 * changes what is drawn, never who is driving it.
 */

import { useEffect, useRef, useState } from "react";

import type { CharacterAnimation } from "@/character/CharacterAnimation";
import type { CharacterStateMachine } from "@/character/CharacterStateMachine";
import { resolveRenderer } from "@/character/renderers";
import type { CharacterPose } from "@/character/types";
import { DEFAULT_POSE } from "@/character/types";
import type { RendererId } from "@/types";

export interface CharacterStageProps {
  machine: CharacterStateMachine;
  animation: CharacterAnimation;
  rendererId: RendererId;
  width: number;
  height: number;
  intensity: number;
  onActivate: () => void;
}

/** Eye contact is worth a little bookkeeping; 60ms is below noticing. */
const GAZE_THROTTLE_MS = 60;

export function CharacterStage({
  machine,
  animation,
  rendererId,
  width,
  height,
  intensity,
  onActivate,
}: CharacterStageProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const lastGaze = useRef(0);
  // Only state/expression flow through React; everything continuous is CSS.
  const [pose, setPose] = useState<CharacterPose>(DEFAULT_POSE);

  useEffect(() => {
    animation.attach(stageRef.current);
    return () => animation.attach(null);
  }, [animation]);

  useEffect(
    () =>
      machine.subscribe(({ state, expression }) =>
        setPose((prev) =>
          prev.state === state && prev.expression === expression
            ? prev
            : { ...prev, state, expression },
        ),
      ),
    [machine],
  );

  const renderer = resolveRenderer(rendererId);
  const Render = renderer.Component;

  return (
    <div
      ref={stageRef}
      className="character-stage"
      data-state={pose.state}
      style={{ width, height }}
      onPointerMove={(event) => {
        const now = performance.now();
        if (now - lastGaze.current < GAZE_THROTTLE_MS) return;
        lastGaze.current = now;
        const box = event.currentTarget.getBoundingClientRect();
        // Map the pointer into -1..1 around the head, which sits in the upper
        // third of the figure.
        const cx = box.left + box.width / 2;
        const cy = box.top + box.height * 0.32;
        animation.glanceAt(
          Math.max(-1, Math.min(1, (event.clientX - cx) / (box.width * 0.9))),
          Math.max(-1, Math.min(1, (event.clientY - cy) / (box.height * 0.55))),
          180,
        );
      }}
      onClick={onActivate}
    >
      <Render pose={pose} width={width} height={height} intensity={intensity} />
    </div>
  );
}
