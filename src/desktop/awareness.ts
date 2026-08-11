/**
 * Desktop activity tracking.
 *
 * Knowing *which* app is in front is only half of it — a useful reaction needs
 * to know whether you just opened it or have been in it for two hours, whether
 * it's the first time today, and whether you're actually working or bouncing
 * between windows. All of that is derived here, locally, from the foreground
 * events Rust emits. Nothing is sent anywhere.
 *
 * Per-day totals live in local storage so "first time today" and "you've been
 * in the browser for three hours" survive a restart. Only executable names and
 * durations are kept; window titles are never captured in the first place.
 */

import type { ActiveApp } from "@/types";

const STORAGE_KEY = "aura.activity.v1";
/** Switching faster than this many times in the window counts as scattered. */
const SCATTER_THRESHOLD = 6;
const SCATTER_WINDOW_MS = 5 * 60 * 1000;
/** A gap longer than this ends a focus session. */
const FOCUS_BREAK_MS = 8 * 60 * 1000;

export interface ActivityContext {
  app: ActiveApp | null;
  previous: ActiveApp | null;
  /** How long the current app has been in front. */
  dwellMs: number;
  /** App switches within the last few minutes. */
  recentSwitches: number;
  /** Bouncing between windows rather than working in one. */
  scattered: boolean;
  /** First time this app has been in front today. */
  firstToday: boolean;
  /** Time since this app was last in front, or null if never. */
  sinceLastSeenMs: number | null;
  /** Total foreground time for this app today. */
  todayMs: number;
  /** Minutes of continuous activity since the last real break. */
  focusMinutes: number;
}

interface StoredDay {
  date: string;
  /** exe -> total foreground milliseconds today. */
  totals: Record<string, number>;
  /** exe -> epoch ms when it was last in front. */
  lastSeen: Record<string, number>;
}

function today(): string {
  return new Date().toDateString();
}

function loadDay(): StoredDay {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredDay;
      if (parsed.date === today()) {
        return {
          date: parsed.date,
          totals: parsed.totals ?? {},
          lastSeen: parsed.lastSeen ?? {},
        };
      }
    }
  } catch {
    /* a corrupt activity file is not worth failing over */
  }
  return { date: today(), totals: {}, lastSeen: {} };
}

export class ActivityTracker {
  private day: StoredDay = loadDay();
  private current: ActiveApp | null = null;
  private previous: ActiveApp | null = null;
  private enteredAt = Date.now();
  private switches: number[] = [];
  private focusStart = Date.now();
  private lastActivityAt = Date.now();

  /** Record a foreground change. Returns the context describing it. */
  record(app: ActiveApp): ActivityContext {
    const now = Date.now();
    this.rollOverIfNewDay();

    // Bank the time spent in the app we're leaving.
    if (this.current) {
      const spent = now - this.enteredAt;
      if (spent > 0) {
        this.day.totals[this.current.exe] =
          (this.day.totals[this.current.exe] ?? 0) + spent;
      }
    }

    // A long silence means the previous focus session ended.
    if (now - this.lastActivityAt > FOCUS_BREAK_MS) {
      this.focusStart = now;
    }
    this.lastActivityAt = now;

    const sinceLastSeen = this.day.lastSeen[app.exe];
    const firstToday = sinceLastSeen === undefined;

    this.previous = this.current;
    this.current = app;
    this.enteredAt = now;
    this.day.lastSeen[app.exe] = now;

    this.switches.push(now);
    this.switches = this.switches.filter((t) => now - t < SCATTER_WINDOW_MS);

    this.persist();

    return {
      app,
      previous: this.previous,
      dwellMs: 0,
      recentSwitches: this.switches.length,
      scattered: this.switches.length >= SCATTER_THRESHOLD,
      firstToday,
      sinceLastSeenMs: firstToday ? null : now - (sinceLastSeen ?? now),
      todayMs: this.day.totals[app.exe] ?? 0,
      focusMinutes: Math.round((now - this.focusStart) / 60_000),
    };
  }

  /** Current context without recording a change — for prompts and nudges. */
  snapshot(): ActivityContext {
    const now = Date.now();
    const app = this.current;
    const switches = this.switches.filter((t) => now - t < SCATTER_WINDOW_MS);
    const banked = app ? (this.day.totals[app.exe] ?? 0) : 0;
    return {
      app,
      previous: this.previous,
      dwellMs: app ? now - this.enteredAt : 0,
      recentSwitches: switches.length,
      scattered: switches.length >= SCATTER_THRESHOLD,
      firstToday: false,
      sinceLastSeenMs: null,
      // Include the time not yet banked, so "two hours in the editor" is true
      // while you are still sitting in the editor.
      todayMs: banked + (app ? now - this.enteredAt : 0),
      focusMinutes: Math.round((now - this.focusStart) / 60_000),
    };
  }

  /** Note that the user interacted with AURA, which also counts as activity. */
  noteInteraction(): void {
    const now = Date.now();
    if (now - this.lastActivityAt > FOCUS_BREAK_MS) this.focusStart = now;
    this.lastActivityAt = now;
  }

  /** The apps the user has spent the most time in today. */
  topApps(limit = 3): { exe: string; ms: number }[] {
    const snapshot = { ...this.day.totals };
    if (this.current) {
      snapshot[this.current.exe] =
        (snapshot[this.current.exe] ?? 0) + (Date.now() - this.enteredAt);
    }
    return Object.entries(snapshot)
      .map(([exe, ms]) => ({ exe, ms }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, limit);
  }

  clear(): void {
    this.day = { date: today(), totals: {}, lastSeen: {} };
    this.switches = [];
    localStorage.removeItem(STORAGE_KEY);
  }

  private rollOverIfNewDay(): void {
    if (this.day.date === today()) return;
    this.day = { date: today(), totals: {}, lastSeen: {} };
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.day));
    } catch {
      /* storage full — activity stats are a nicety, not state we owe */
    }
  }
}

/** Human phrasing for a duration, for use in prompts and lines. */
export function describeDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${hours}h ${rest}m`;
}
