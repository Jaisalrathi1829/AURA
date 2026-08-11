/**
 * Character state machine.
 *
 * Owns which {@link CharacterState} AURA is in and the expression that goes
 * with it. Transitions are deliberately conservative: states that were entered
 * for a transient reason (HAPPY, CURIOUS, CONFUSED) fall back to IDLE on their
 * own, so nothing can leave the character stuck in a pose.
 */

import type { CharacterExpression, CharacterState } from "./types";

/** How long a transient state holds before decaying back to its base. */
const TRANSIENT_MS: Partial<Record<CharacterState, number>> = {
  HAPPY: 3200,
  CURIOUS: 2800,
  CONFUSED: 2600,
  SERIOUS: 4000,
};

/** States that a transient reaction must not interrupt. */
const PRIORITY: Record<CharacterState, number> = {
  SLEEPING: 5,
  TALKING: 4,
  THINKING: 4,
  LISTENING: 3,
  CONFUSED: 2,
  CURIOUS: 2,
  HAPPY: 2,
  SERIOUS: 2,
  IDLE: 1,
};

const NATURAL_EXPRESSION: Record<CharacterState, CharacterExpression> = {
  IDLE: "NEUTRAL",
  LISTENING: "SOFT",
  THINKING: "FOCUSED",
  TALKING: "WARM",
  HAPPY: "AMUSED",
  CURIOUS: "CURIOUS",
  CONFUSED: "PUZZLED",
  SERIOUS: "FOCUSED",
  SLEEPING: "SOFT",
};

export interface CharacterStateSnapshot {
  state: CharacterState;
  expression: CharacterExpression;
  /** Milliseconds since this state was entered. */
  elapsed: number;
}

export type StateListener = (snapshot: CharacterStateSnapshot) => void;

export class CharacterStateMachine {
  private state: CharacterState = "IDLE";
  private expression: CharacterExpression = "NEUTRAL";
  private enteredAt = performance.now();
  private expiresAt: number | null = null;
  private listeners = new Set<StateListener>();

  getState(): CharacterState {
    return this.state;
  }

  getSnapshot(): CharacterStateSnapshot {
    return {
      state: this.state,
      expression: this.expression,
      elapsed: performance.now() - this.enteredAt,
    };
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  /**
   * Request a state. Lower-priority requests are ignored while a
   * higher-priority state is active, which keeps a stray "curious" reaction
   * from cutting off a reply mid-sentence.
   */
  set(
    next: CharacterState,
    options: { expression?: CharacterExpression; force?: boolean } = {},
  ): void {
    const { expression, force = false } = options;

    if (!force && next !== this.state && PRIORITY[next] < PRIORITY[this.state]) {
      // Still honour an expression change even when the state request loses.
      if (expression && expression !== this.expression) {
        this.expression = expression;
        this.emit();
      }
      return;
    }

    const sameState = next === this.state;
    this.state = next;
    this.expression = expression ?? NATURAL_EXPRESSION[next];
    if (!sameState) this.enteredAt = performance.now();

    const ttl = TRANSIENT_MS[next];
    this.expiresAt = ttl ? performance.now() + ttl : null;
    this.emit();
  }

  /** Drive transient decay. Called once per animation frame. */
  tick(now: number): void {
    if (this.expiresAt !== null && now >= this.expiresAt) {
      this.expiresAt = null;
      this.set("IDLE", { force: true });
    }
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
