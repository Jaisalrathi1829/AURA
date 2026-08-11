/**
 * The animation driver — what makes AURA read as alive rather than displayed.
 *
 * Two channels, on purpose:
 *
 *  - **Continuous** motion (breathing, blinking, gaze, sway) is written
 *    straight onto a DOM element as CSS custom properties inside one rAF loop.
 *    It never touches React, so a character that is always on screen costs a
 *    handful of style writes per frame instead of a render tree per frame.
 *  - **Discrete** changes (state, expression) go through React normally,
 *    because they happen a few times a minute.
 *
 * The loop stops entirely when the overlay is hidden or the tab is backgrounded.
 */

import type { CharacterPose, CharacterState } from "./types";
import { DEFAULT_POSE } from "./types";
import type { CharacterStateMachine } from "./CharacterStateMachine";

/** ~40fps. Above this the motion is imperceptibly smoother but costs real CPU. */
const FRAME_BUDGET_MS = 24;

const BLINK_DURATION = 120;
const BREATH_PERIOD = 3900;
const SWAY_PERIOD = 11000;

interface Saccade {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  start: number;
  duration: number;
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** Per-state tuning. Everything the "personality" of the motion hangs off. */
interface StateProfile {
  /** Range of milliseconds between blinks. */
  blinkGap: [number, number];
  /** Amplitude multipliers. */
  gaze: number;
  head: number;
  breathDepth: number;
  breathRate: number;
  /** Resting values. */
  brow: number;
  smile: number;
  /** Baseline eyelid closure — SLEEPING sits nearly shut. */
  lidRest: number;
  /** How often the gaze re-targets. */
  saccadeGap: [number, number];
  /** Bias applied to the gaze target, e.g. THINKING looks up and away. */
  gazeBias: [number, number];
  glow: number;
}

const PROFILES: Record<CharacterState, StateProfile> = {
  IDLE: {
    blinkGap: [2600, 6800],
    gaze: 1,
    head: 1,
    breathDepth: 1,
    breathRate: 1,
    brow: 0,
    smile: 0.08,
    lidRest: 0,
    saccadeGap: [1800, 5200],
    gazeBias: [0, 0],
    glow: 0.5,
  },
  LISTENING: {
    // Attention reads as steadier eyes and a slightly held breath.
    blinkGap: [3400, 7600],
    gaze: 0.45,
    head: 0.5,
    breathDepth: 0.75,
    breathRate: 0.9,
    brow: 0.22,
    smile: 0.12,
    lidRest: 0,
    saccadeGap: [2600, 6000],
    gazeBias: [0, 0.12],
    glow: 0.78,
  },
  THINKING: {
    blinkGap: [3000, 7000],
    gaze: 1.25,
    head: 1.15,
    breathDepth: 0.9,
    breathRate: 0.95,
    brow: -0.18,
    smile: 0.02,
    lidRest: 0.06,
    saccadeGap: [900, 2200],
    // Looking up and to one side is the universal "working on it".
    gazeBias: [-0.42, -0.34],
    glow: 0.9,
  },
  TALKING: {
    blinkGap: [2800, 6400],
    gaze: 0.6,
    head: 0.85,
    breathDepth: 0.7,
    breathRate: 1.15,
    brow: 0.1,
    smile: 0.16,
    lidRest: 0,
    saccadeGap: [1600, 3800],
    gazeBias: [0, 0.06],
    glow: 0.86,
  },
  HAPPY: {
    blinkGap: [2400, 5200],
    gaze: 0.8,
    head: 1,
    breathDepth: 1.1,
    breathRate: 1.05,
    brow: 0.3,
    smile: 0.72,
    // A genuine smile narrows the eyes a little.
    lidRest: 0.16,
    saccadeGap: [1600, 3600],
    gazeBias: [0, 0.04],
    glow: 0.82,
  },
  CURIOUS: {
    blinkGap: [2200, 5000],
    gaze: 1.1,
    head: 1.3,
    breathDepth: 1,
    breathRate: 1,
    brow: 0.55,
    smile: 0.2,
    lidRest: 0,
    saccadeGap: [1000, 2600],
    gazeBias: [0.2, -0.1],
    glow: 0.72,
  },
  CONFUSED: {
    blinkGap: [2000, 4600],
    gaze: 1.15,
    head: 1.2,
    breathDepth: 0.95,
    breathRate: 1,
    brow: -0.5,
    smile: 0.02,
    lidRest: 0.05,
    saccadeGap: [800, 2000],
    gazeBias: [-0.2, 0.1],
    glow: 0.6,
  },
  SERIOUS: {
    blinkGap: [3600, 8200],
    gaze: 0.35,
    head: 0.4,
    breathDepth: 0.8,
    breathRate: 0.85,
    brow: -0.28,
    smile: 0,
    lidRest: 0.03,
    saccadeGap: [3000, 7000],
    gazeBias: [0, 0.05],
    glow: 0.55,
  },
  SLEEPING: {
    blinkGap: [9000, 16000],
    gaze: 0.1,
    head: 0.35,
    breathDepth: 1.5,
    breathRate: 0.5,
    brow: -0.05,
    smile: 0.06,
    lidRest: 0.93,
    saccadeGap: [6000, 12000],
    gazeBias: [0, 0.5],
    glow: 0.22,
  },
};

export class CharacterAnimation {
  private target: HTMLElement | null = null;
  private machine: CharacterStateMachine;
  private intensity = 1;
  private running = false;
  private frame = 0;
  private lastWrite = 0;

  // Blink scheduling.
  private nextBlinkAt = 0;
  private blinkStart = -1;
  private blinkQueued = 0;

  // Gaze.
  private saccade: Saccade | null = null;
  private nextSaccadeAt = 0;
  private gazeX = 0;
  private gazeY = 0;

  // Smoothed channels so state changes ease instead of snapping.
  private smooth = { brow: 0, smile: 0, lid: 0, glow: 0.5, mouth: 0, sleep: 0 };

  // Speech envelope.
  private speaking = false;
  private speechSeed = Math.random() * 1000;

  private pose: CharacterPose = { ...DEFAULT_POSE };

  constructor(machine: CharacterStateMachine) {
    this.machine = machine;
    const now = performance.now();
    this.nextBlinkAt = now + rand(1200, 3000);
    this.nextSaccadeAt = now + rand(900, 2400);
  }

  attach(element: HTMLElement | null): void {
    this.target = element;
  }

  setIntensity(intensity: number): void {
    this.intensity = clamp01(intensity);
  }

  /** Drives mouth movement while a reply streams in. */
  setSpeaking(speaking: boolean): void {
    this.speaking = speaking;
  }

  /** A deliberate blink, e.g. as a reaction to being clicked. */
  blinkNow(count = 1): void {
    this.blinkQueued = Math.max(this.blinkQueued, count);
    this.nextBlinkAt = performance.now();
  }

  /** Point the eyes somewhere specific, in normalised -1..1 coordinates. */
  glanceAt(x: number, y: number, duration = 260): void {
    const now = performance.now();
    this.saccade = {
      fromX: this.gazeX,
      fromY: this.gazeY,
      toX: Math.max(-1, Math.min(1, x)),
      toY: Math.max(-1, Math.min(1, y)),
      start: now,
      duration,
    };
    this.nextSaccadeAt = now + rand(1400, 3000);
  }

  getPose(): CharacterPose {
    return this.pose;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const step = (now: number) => {
      if (!this.running) return;
      this.frame = requestAnimationFrame(step);
      this.machine.tick(now);
      if (now - this.lastWrite < FRAME_BUDGET_MS) return;
      this.lastWrite = now;
      this.update(now);
    };
    this.frame = requestAnimationFrame(step);
  }

  stop(): void {
    this.running = false;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private update(now: number): void {
    const snapshot = this.machine.getSnapshot();
    const profile = PROFILES[snapshot.state];
    const amp = this.intensity;

    // ---- blinking ------------------------------------------------------
    if (this.blinkStart < 0 && now >= this.nextBlinkAt) {
      this.blinkStart = now;
    }
    let blink = 0;
    if (this.blinkStart >= 0) {
      const t = (now - this.blinkStart) / BLINK_DURATION;
      if (t >= 1) {
        this.blinkStart = -1;
        if (this.blinkQueued > 0) {
          this.blinkQueued -= 1;
          // Double blinks land close together; they read as very natural.
          this.nextBlinkAt = now + 90;
        } else {
          const [lo, hi] = profile.blinkGap;
          // Occasional double blink without being asked.
          if (Math.random() < 0.16) this.blinkQueued = 1;
          this.nextBlinkAt = now + rand(lo, hi);
        }
      } else {
        // Close fast, open slower — the asymmetry is what sells it.
        blink = t < 0.42 ? easeOut(t / 0.42) : 1 - easeInOut((t - 0.42) / 0.58);
      }
    }

    // ---- gaze ----------------------------------------------------------
    if (!this.saccade && now >= this.nextSaccadeAt) {
      const [lo, hi] = profile.saccadeGap;
      const [bx, by] = profile.gazeBias;
      this.saccade = {
        fromX: this.gazeX,
        fromY: this.gazeY,
        toX: Math.max(-1, Math.min(1, bx + rand(-0.5, 0.5))),
        toY: Math.max(-1, Math.min(1, by + rand(-0.35, 0.35))),
        start: now,
        // Real saccades are fast; the pause between them is the slow part.
        duration: rand(90, 170),
      };
      this.nextSaccadeAt = now + rand(lo, hi);
    }
    if (this.saccade) {
      const t = (now - this.saccade.start) / this.saccade.duration;
      if (t >= 1) {
        this.gazeX = this.saccade.toX;
        this.gazeY = this.saccade.toY;
        this.saccade = null;
      } else {
        const e = easeOut(t);
        this.gazeX = lerp(this.saccade.fromX, this.saccade.toX, e);
        this.gazeY = lerp(this.saccade.fromY, this.saccade.toY, e);
      }
    }

    // ---- breathing and body --------------------------------------------
    const breathPhase = (now / (BREATH_PERIOD / profile.breathRate)) * Math.PI * 2;
    const breath = Math.sin(breathPhase) * profile.breathDepth * amp;
    const sway = Math.sin(now / SWAY_PERIOD * Math.PI * 2) * 0.6 * amp;

    // ---- head ----------------------------------------------------------
    // Two incommensurate periods keep the drift from ever looking looped.
    const yaw =
      (Math.sin(now / 7300) * 0.62 + Math.sin(now / 4100) * 0.24) *
      profile.head *
      amp;
    const tiltBase =
      (Math.sin(now / 9100) * 0.5 + Math.sin(now / 5300) * 0.18) *
      profile.head *
      amp;
    const tiltPose =
      snapshot.state === "CURIOUS" ? 0.55 : snapshot.state === "CONFUSED" ? -0.42 : 0;
    // The head follows the eyes a little, as a real head does.
    const tilt = tiltBase + tiltPose + this.gazeX * 0.12 * profile.head;

    // ---- mouth ---------------------------------------------------------
    let mouthTarget = 0;
    if (this.speaking && snapshot.state === "TALKING") {
      // A layered envelope, not a metronome: syllable rate plus a slower
      // phrase contour, floored so the lips never fully clamp mid-word.
      const s = this.speechSeed;
      const syllable = Math.sin((now + s) / 105) * 0.5 + 0.5;
      const phrase = Math.sin((now + s) / 640) * 0.5 + 0.5;
      const flutter = Math.sin((now + s) / 47) * 0.5 + 0.5;
      mouthTarget = clamp01(syllable * 0.62 * (0.45 + phrase * 0.55) + flutter * 0.12);
    }

    // ---- smoothing -----------------------------------------------------
    // Expression channels ease toward their target so states blend rather
    // than pop. Mouth eases faster because speech is fast.
    this.smooth.brow = lerp(this.smooth.brow, profile.brow * amp, 0.08);
    this.smooth.smile = lerp(this.smooth.smile, profile.smile, 0.07);
    this.smooth.lid = lerp(this.smooth.lid, profile.lidRest, 0.06);
    this.smooth.glow = lerp(this.smooth.glow, profile.glow, 0.05);
    this.smooth.mouth = lerp(this.smooth.mouth, mouthTarget, 0.35);
    // Drives the head dropping as AURA dozes off, and lifting when she wakes.
    this.smooth.sleep = lerp(this.smooth.sleep, snapshot.state === "SLEEPING" ? 1 : 0, 0.03);

    const lid = clamp01(Math.max(blink, this.smooth.lid));

    this.pose = {
      state: snapshot.state,
      expression: snapshot.expression,
      blink: lid,
      gazeX: this.gazeX * profile.gaze,
      gazeY: this.gazeY * profile.gaze,
      headYaw: yaw,
      headTilt: tilt,
      breath,
      mouth: this.smooth.mouth,
      smile: this.smooth.smile,
      brow: this.smooth.brow,
      sway,
      glow: this.smooth.glow,
    };

    this.write(this.pose);
  }

  /** Push the pose onto the DOM as custom properties. */
  private write(pose: CharacterPose): void {
    const el = this.target;
    if (!el) return;
    const s = el.style;
    s.setProperty("--a-blink", pose.blink.toFixed(3));
    s.setProperty("--a-gaze-x", pose.gazeX.toFixed(3));
    s.setProperty("--a-gaze-y", pose.gazeY.toFixed(3));
    s.setProperty("--a-head-yaw", pose.headYaw.toFixed(3));
    s.setProperty("--a-head-tilt", pose.headTilt.toFixed(3));
    s.setProperty("--a-breath", pose.breath.toFixed(3));
    s.setProperty("--a-mouth", pose.mouth.toFixed(3));
    s.setProperty("--a-smile", pose.smile.toFixed(3));
    s.setProperty("--a-brow", pose.brow.toFixed(3));
    s.setProperty("--a-sway", pose.sway.toFixed(3));
    s.setProperty("--a-glow", pose.glow.toFixed(3));
    s.setProperty("--a-sleep", this.smooth.sleep.toFixed(3));
  }
}
