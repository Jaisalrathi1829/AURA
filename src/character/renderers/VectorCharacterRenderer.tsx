/**
 * Built-in renderer: the hand-rigged vector figure.
 *
 * Continuous animation reaches this component through CSS custom properties on
 * an ancestor (see `CharacterAnimation`), so it renders once and then stays put
 * while the character moves.
 */

import { memo } from "react";

import { AuraFigure } from "../assets/AuraFigure";
import type { CharacterRenderProps, CharacterRenderer } from "../types";

const VectorCharacter = memo(function VectorCharacter({
  pose,
  width,
  height,
}: CharacterRenderProps) {
  return (
    <div
      className="character-render character-render--vector"
      style={{ width, height }}
      data-state={pose.state}
      data-expression={pose.expression}
    >
      <AuraFigure />
    </div>
  );
});

export const vectorRenderer: CharacterRenderer = {
  id: "vector",
  displayName: "AURA — Vector (built in)",
  description:
    "Hand-rigged vector figure. Ships with the app, animates every expression, costs almost nothing to run.",
  probeAssets: async () => ({ available: true, detail: "Built in." }),
  Component: VectorCharacter,
};
