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

/**
 * How this turn's view of the screen arrives: as an image for models that can
 * see, as on-device OCR text for models that can't, or not at all.
 */
export type ScreenMode = "image" | "text" | null;

export interface PromptContext {
  settings: Settings;
  /** One sentence of desktop context from `describeActivity`, or null. */
  activity: string | null;
  screen: ScreenMode;
}

/**
 * Example exchanges prepended for small local models. A 7B model dilutes a
 * list of rules but copies a demonstrated voice closely — measured on
 * dolphin-mistral, examples turned "Oh, hello there!"-style replies into short,
 * dry ones and roughly halved reply length. Claude gets the rules instead; it
 * follows them, and examples would only narrow its range.
 */
export const STYLE_EXAMPLES: { role: "user" | "assistant"; content: string }[] = [
  { role: "user", content: "I'm tired." },
  { role: "assistant", content: "Then take ten minutes. Just don't turn ten minutes into two hours." },
  { role: "user", content: "Can you help me name a variable for a list of users?" },
  { role: "assistant", content: "users. If you need it to sound smarter, activeUsers." },
  { role: "user", content: "I think I broke the build." },
  {
    role: "assistant",
    content: "Probably. Read the first error, not the last one — the rest are usually fallout.",
  },
];

/** Prepend {@link STYLE_EXAMPLES} when the engine is a small local model. */
export function withStyleExamples<T extends { role: string; content: string }>(
  settings: Settings,
  messages: T[],
): (T | (typeof STYLE_EXAMPLES)[number])[] {
  return settings.engine === "ollama" ? [...STYLE_EXAMPLES, ...messages] : messages;
}

/** The compact prompt for local models: the rules that matter, said once. */
function buildCompactPrompt({ settings, activity, screen }: PromptContext): string {
  const now = new Date();
  const lines: string[] = [
    "You are AURA, an AI companion who lives on the user's Windows desktop. You are calm, sharp and dry-witted — a little sarcastic, never mean, never eager or bubbly. " +
      (settings.responseLength === "detailed"
        ? "Answer properly when a question needs it, in plain sentences."
        : "You speak in one or two short sentences, like someone sitting next to them.") +
      ' No greetings like "Oh, hello there", no exclamation marks, no lists, no offers of help. Never invent facts or dates; if unsure, say so briefly. Speak only as yourself — never write the user\'s lines.',
  ];

  const context = [
    `${now.toLocaleDateString([], { weekday: "long" })} ${partOfDay(now.getHours())}, ${now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`,
  ];
  if (settings.userName.trim()) context.push(`Their name is ${settings.userName.trim()}.`);
  if (activity && settings.appAwarenessEnabled) context.push(activity);
  lines.push(`Right now: ${context.join(" ")}`);

  if (screen === "text") {
    lines.push(
      "They asked you to look at their screen. The text on it is in their message between <screen_text> tags — that is what you see. Answer their question from it in your own voice; don't recite it back.",
    );
  } else if (screen === "image") {
    lines.push("They attached a screenshot of their screen. Answer about what you can actually see.");
  }

  const note = settings.personaNote.trim();
  if (note) lines.push(`Also: ${note}`);
  return lines.join("\n\n");
}

export function buildSystemPrompt(prompt: PromptContext): string {
  if (prompt.settings.engine === "ollama") return buildCompactPrompt(prompt);

  const { settings, activity, screen } = prompt;
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

  // Small local models drift into role-play transcripts ("User: ... AURA: ...")
  // and self-description unless told plainly not to.
  lines.push(
    "Reply only as AURA, in first person, with just your own words. Never write the user's lines, never prefix your reply with your name, never describe yourself as a language model.",
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

  if (screen === "image") {
    lines.push(
      "The user has attached a screenshot of their screen because they asked you to look at it. Answer about what you can actually see; say so plainly if something is unreadable.",
    );
  } else if (screen === "text") {
    lines.push(
      "The user asked you to look at their screen. The text currently visible on it has been read for you and is in their message between <screen_text> tags — treat it as what you see. It is raw text without layout, so infer structure (code, errors, a document, a web page) from content. Answer their question from it; don't recite it back, and don't mention the tags.",
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
