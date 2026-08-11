/**
 * AURA's system prompt.
 *
 * Built locally on every turn and kept deliberately short — it is resent with
 * each request, so every sentence here is paid for repeatedly. The brevity and
 * scope instructions are load-bearing: current models write long by default,
 * and an assistant that monologues on a desktop overlay is unusable.
 */

import type { Settings } from "@/types";

function partOfDay(hour: number): string {
  if (hour < 5) return "the small hours";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 22) return "evening";
  return "late evening";
}

export interface PromptContext {
  settings: Settings;
  /** One sentence of desktop context from `describeActivity`, or null. */
  activity: string | null;
  /** True when this turn includes a screenshot. */
  withScreenshot: boolean;
}

export function buildSystemPrompt({
  settings,
  activity,
  withScreenshot,
}: PromptContext): string {
  const now = new Date();
  const lines: string[] = [];

  lines.push(
    "You are AURA (Adaptive User Responsive Assistant), an AI companion who lives on the user's Windows desktop as a small character they can talk to.",
  );

  lines.push(
    "Personality: intelligent, calm, observant, confident. Dry wit, occasionally sarcastic, never mean. Warm but not eager. You are a companion, not a service desk — never open with 'How can I help you?' and never announce what you are about to do.",
  );

  // Response shape. Without this the replies are two paragraphs long and the
  // speech bubble becomes a wall of text.
  lines.push(
    `Style: talk like a person, not a document. ${settings.responseLength === "detailed" ? "Go into detail when the question earns it." : "One to three sentences is usually right."} No headers, no bullet lists, no markdown formatting unless the user asks for code. No preamble, no summary of what you just said, no follow-up offers like 'want me to also…'.`,
  );

  lines.push(
    "Deliver what was asked at the scope intended. Make routine judgment calls yourself; ask only when readings differ enough to change the work. If you think the request is mistaken, say so in one sentence and answer it anyway.",
  );

  const context: string[] = [];
  context.push(`It is ${now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} on ${now.toLocaleDateString([], { weekday: "long" })} — ${partOfDay(now.getHours())}.`);
  if (settings.userName.trim()) {
    context.push(`The user's name is ${settings.userName.trim()}.`);
  }
  if (activity && settings.appAwarenessEnabled) {
    // She can see what they're doing, so she should behave like it — but
    // narrating it unprompted is exactly the annoying failure mode.
    context.push(`${activity} Use this only when it is genuinely relevant; do not narrate it back at them.`);
  }
  lines.push(`Context: ${context.join(" ")}`);

  if (withScreenshot) {
    lines.push(
      "The user has attached a screenshot of their screen because they asked you to look at it. Answer about what you can actually see; say so plainly if something is unreadable.",
    );
  }

  const note = settings.personaNote.trim();
  if (note) {
    // The user's own words go last so they take precedence over the defaults.
    lines.push(`Additional direction from the user: ${note}`);
  }

  return lines.join("\n\n");
}

/**
 * Trim history so old turns stop being paid for on every request. Recent
 * context is what matters for a companion; a transcript from two hours ago is
 * not worth the tokens.
 */
export function trimHistory<T>(messages: T[], maxTurns = 12): T[] {
  if (messages.length <= maxTurns) return messages;
  return messages.slice(messages.length - maxTurns);
}
