/**
 * What AURA says when she notices you switch apps.
 *
 * Two tiers, both driven by the same {@link ActivityContext}:
 *
 *  - **local** (default, free) — the table below, chosen from the actual
 *    situation rather than at random: what you left, what you opened, how long
 *    you were there, whether it's the first time today, whether you're focused
 *    or bouncing.
 *  - **claude** (opt-in, costs credit) — {@link buildReactionPrompt} turns the
 *    same context into a very small prompt so the line is genuinely about what
 *    you just did.
 *
 * The selection logic is shared, so turning Claude off changes how good the
 * lines are, never whether the feature works.
 */

import type { ActivityContext } from "@/desktop/awareness";
import { describeDuration } from "@/desktop/awareness";

export interface ReactionDecision {
  /** Null means stay quiet — the common case, by design. */
  line: string | null;
  /** Why she spoke, for the Claude prompt and for the character's mood. */
  reason: ReactionReason;
}

export type ReactionReason =
  | "scattered"
  | "first-today"
  | "returning"
  | "back-to-work"
  | "distraction"
  | "deep-focus"
  | "late-night"
  | "opened"
  | "none";

const pick = <T,>(items: readonly T[]): T =>
  items[Math.floor(Math.random() * items.length)] as T;

const WORK_CATEGORIES = new Set(["editor", "terminal", "devtools", "documents", "notes", "design"]);
const LEISURE_CATEGORIES = new Set(["games", "social", "media"]);

const OPENED: Record<string, readonly string[]> = {
  editor: ["Back to coding?", "Editor's open. That usually means business.", "Right. Real work."],
  terminal: [
    "Terminal. Something's about to happen.",
    "Shell's up. Try not to rm anything you'll miss.",
  ],
  browser: ["Research, or 'research'?", "The browser again. I won't ask.", "Off to the internet, then."],
  devtools: ["Tooling. The unglamorous half of the job.", "Something's being debugged."],
  files: ["Looking for something?", "File Explorer. The eternal search."],
  media: ["Background noise. Good — it usually helps.", "Music on. Focus or avoidance, we'll see."],
  games: ["Well. That's one way to spend the time.", "Games. I'll allow it."],
  social: ["Ten minutes, we both know it won't be.", "Chat's open. Good luck."],
  documents: ["Documents. My condolences.", "Writing something, then."],
  notes: ["Notes. Someone's being organised.", "Good — write it down before it evaporates."],
  design: ["Design work. The fun kind of difficult.", "Making something look right."],
  email: ["Email. Brave.", "The inbox. Set a timer."],
  meeting: ["A call. I'll keep quiet.", "Meeting time. Try to look interested."],
  system: ["Poking at Windows settings. Careful.", "System settings. What broke?"],
  reading: ["Reading. Underrated.", "Good — something that isn't a screen full of code."],
};

const SCATTERED = [
  "That's the fifth window in five minutes. What are you actually looking for?",
  "You're bouncing. Pick one thing.",
  "A lot of switching going on. Everything alright?",
];

const BACK_TO_WORK = [
  "Back to it.",
  "Good. Where were we?",
  "Focus reacquired.",
];

const DISTRACTION = [
  "That didn't take long.",
  "Ah. The pivot.",
  "Break, or escape?",
];

const RETURNING = [
  "Been a while since you were in here.",
  "Returning to the scene.",
  "Back to this one, then.",
];

const DEEP_FOCUS = [
  "You've been in this a long stretch. Still with me?",
  "Solid run. Don't forget to stand up at some point.",
];

const LATE_NIGHT = [
  "It's late for this.",
  "This is the hour where bugs get written, not fixed.",
  "Late. Whatever it is will still be there tomorrow.",
];

/**
 * Decide whether to react and with what. Returning `line: null` is the normal
 * outcome — an assistant that comments on every window is unusable.
 */
export function decideReaction(
  ctx: ActivityContext,
  options: { hour: number; chattiness: number } = { hour: 12, chattiness: 0.35 },
): ReactionDecision {
  const app = ctx.app;
  if (!app) return { line: null, reason: "none" };

  const { hour, chattiness } = options;
  const previous = ctx.previous;
  const category = app.category;

  // Bouncing between windows is worth saying something about even when she
  // would otherwise stay quiet — it is the one pattern the user cannot see.
  if (ctx.scattered) {
    return { line: pick(SCATTERED), reason: "scattered" };
  }

  // Late-night work gets a nudge regardless of chattiness.
  if ((hour >= 1 && hour < 5) && WORK_CATEGORIES.has(category)) {
    return { line: pick(LATE_NIGHT), reason: "late-night" };
  }

  // Everything below is optional colour, so roll for it first.
  if (Math.random() > chattiness) return { line: null, reason: "none" };

  // Leaving leisure for work, or the reverse, is the most legible transition.
  if (previous && LEISURE_CATEGORIES.has(previous.category) && WORK_CATEGORIES.has(category)) {
    return { line: pick(BACK_TO_WORK), reason: "back-to-work" };
  }
  if (
    previous &&
    WORK_CATEGORIES.has(previous.category) &&
    LEISURE_CATEGORIES.has(category) &&
    ctx.focusMinutes < 25
  ) {
    return { line: pick(DISTRACTION), reason: "distraction" };
  }

  if (ctx.firstToday && OPENED[category]) {
    return {
      line: `First time in ${app.label} today. ${pick(OPENED[category]!)}`,
      reason: "first-today",
    };
  }

  if (ctx.sinceLastSeenMs !== null && ctx.sinceLastSeenMs > 3 * 60 * 60 * 1000) {
    return { line: pick(RETURNING), reason: "returning" };
  }

  if (ctx.focusMinutes >= 90 && WORK_CATEGORIES.has(category)) {
    return { line: pick(DEEP_FOCUS), reason: "deep-focus" };
  }

  const lines = OPENED[category];
  if (!lines) return { line: null, reason: "none" };
  return { line: pick(lines), reason: "opened" };
}

/**
 * A compact description of the situation, used both as the Claude prompt for a
 * live reaction and as the desktop-context block in the conversation's system
 * prompt. Kept terse — it is resent on every turn.
 */
export function describeActivity(ctx: ActivityContext): string {
  const app = ctx.app;
  if (!app) return "No foreground application detected.";

  const parts: string[] = [`They are in ${app.label} (${app.category})`];
  if (ctx.dwellMs > 60_000) parts.push(`for ${describeDuration(ctx.dwellMs)}`);
  if (ctx.previous && ctx.previous.exe !== app.exe) {
    parts.push(`having just come from ${ctx.previous.label}`);
  }

  const extra: string[] = [];
  if (ctx.firstToday) extra.push("first time in it today");
  else if (ctx.todayMs > 30 * 60_000) {
    extra.push(`${describeDuration(ctx.todayMs)} in it today`);
  }
  if (ctx.scattered) extra.push("switching between windows a lot");
  if (ctx.focusMinutes >= 60) extra.push(`working for ${ctx.focusMinutes} minutes straight`);

  const sentence = parts.join(" ") + ".";
  return extra.length ? `${sentence} Also: ${extra.join(", ")}.` : sentence;
}

/** The user-turn prompt for a Claude-written reaction. */
export function buildReactionPrompt(ctx: ActivityContext, reason: ReactionReason): string {
  return [
    describeActivity(ctx),
    reason !== "none" && reason !== "opened"
      ? `What stands out: ${reason.replace(/-/g, " ")}.`
      : "",
    "React with a single short line — one sentence, at most two. In character. Do not ask what they need, do not offer help, do not use their name. If there is genuinely nothing worth saying, reply with exactly: SKIP",
  ]
    .filter(Boolean)
    .join(" ");
}
