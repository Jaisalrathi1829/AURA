/**
 * AURA's voice: the speech voices built into Windows, driven through the Web
 * Speech API that WebView2 exposes. Entirely local — no model, no network, no
 * cost — and it starts talking as soon as the first sentence of a reply has
 * streamed in, rather than waiting for the model to finish.
 */

import type { TextToSpeechProvider, TextToSpeechVoice } from "./providers";

/** Voices that read as AURA: female, English. Checked in order. */
const PREFERRED = /\b(aria|jenny|zira|heera|neerja|hazel|susan|catherine|libby|sonia|natasha|clara|linda|eva)\b/i;

function synth(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window
    ? window.speechSynthesis
    : null;
}

/** Voices load asynchronously in Chromium; wait briefly for the list. */
export function loadVoices(timeoutMs = 2000): Promise<SpeechSynthesisVoice[]> {
  const s = synth();
  if (!s) return Promise.resolve([]);
  const now = s.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      s.removeEventListener("voiceschanged", done);
      resolve(s.getVoices());
    };
    s.addEventListener("voiceschanged", done);
    window.setTimeout(done, timeoutMs);
  });
}

export function chooseVoice(
  voices: SpeechSynthesisVoice[],
  preferredName: string,
): SpeechSynthesisVoice | null {
  if (preferredName) {
    const exact = voices.find((v) => v.name === preferredName);
    if (exact) return exact;
  }
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  return (
    english.find((v) => PREFERRED.test(v.name)) ??
    english.find((v) => /female/i.test(v.name)) ??
    english[0] ??
    voices[0] ??
    null
  );
}

/** Make model output sound right read aloud. */
export function speakable(text: string): string {
  return (
    text
      // Links read as noise.
      .replace(/https?:\/\/\S+/g, "a link")
      // Markdown emphasis, headers, bullets and inline code marks.
      .replace(/[*_#`>]+/g, "")
      .replace(/^\s*[-•]\s+/gm, "")
      // Stage directions small models like to add: *smiles*, (laughs).
      .replace(/\((?:laughs|smiles|sighs|chuckles)[^)]*\)/gi, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Where a sentence ends, so speech can start before the reply finishes. */
const SENTENCE_END = /[.!?…]+["')\]]*\s+|\n+/g;
/** Long unpunctuated runs are flushed at a comma rather than held forever. */
const SOFT_LIMIT = 220;

export interface SpeakerOptions {
  onSpeakingChange: (speaking: boolean) => void;
  /** An utterance failed (e.g. the browser refused to speak). */
  onError?: (reason: string) => void;
}

/**
 * Turns streamed reply text into queued utterances, one per sentence. Code
 * blocks are skipped — nobody wants a function read to them.
 */
export class Speaker {
  private buffer = "";
  private inCode = false;
  private active = 0;
  private enabled = true;
  private voiceName = "";
  private rate = 1;
  private voice: SpeechSynthesisVoice | null = null;
  private generation = 0;

  constructor(private readonly options: SpeakerOptions) {}

  get available(): boolean {
    return synth() !== null;
  }

  get speaking(): boolean {
    return this.active > 0;
  }

  /** The Windows voice in use, for diagnostics. */
  get voiceLabel(): string {
    return this.voice ? `${this.voice.name} (${this.voice.lang})` : "none";
  }

  async configure(enabled: boolean, voiceName: string, rate: number): Promise<void> {
    this.enabled = enabled;
    this.rate = rate;
    if (!enabled) this.stop();
    if (voiceName !== this.voiceName || !this.voice) {
      this.voiceName = voiceName;
      this.voice = chooseVoice(await loadVoices(), voiceName);
    }
  }

  /** Speak a complete line (a greeting, a reaction, a quote). */
  say(text: string): void {
    if (!this.enabled) return;
    this.enqueue(text);
  }

  /** Feed a chunk of a streaming reply. */
  feed(chunk: string): void {
    if (!this.enabled) return;
    this.buffer += chunk;

    let spokenUpTo = 0;
    SENTENCE_END.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SENTENCE_END.exec(this.buffer)) !== null) {
      spokenUpTo = match.index + match[0].length;
    }
    if (spokenUpTo === 0 && this.buffer.length > SOFT_LIMIT) {
      const comma = this.buffer.lastIndexOf(", ");
      if (comma > 40) spokenUpTo = comma + 2;
    }
    if (spokenUpTo > 0) {
      this.enqueueStreamed(this.buffer.slice(0, spokenUpTo));
      this.buffer = this.buffer.slice(spokenUpTo);
    }
  }

  /** The reply is complete; speak whatever is left. */
  end(): void {
    if (this.buffer) this.enqueueStreamed(this.buffer);
    this.buffer = "";
    this.inCode = false;
  }

  /** Silence immediately and drop anything queued. */
  stop(): void {
    this.generation += 1;
    this.buffer = "";
    this.inCode = false;
    synth()?.cancel();
    if (this.active !== 0) {
      this.active = 0;
      this.options.onSpeakingChange(false);
    }
  }

  private enqueueStreamed(text: string): void {
    // Toggle out of code blocks; speak only the prose around them.
    const parts = text.split("```");
    parts.forEach((part, i) => {
      if (i > 0) this.inCode = !this.inCode;
      if (!this.inCode) this.enqueue(part);
    });
  }

  private enqueue(raw: string): void {
    const s = synth();
    const text = speakable(raw);
    if (!s || !text) return;

    const generation = this.generation;
    const utterance = new SpeechSynthesisUtterance(text);
    if (this.voice) utterance.voice = this.voice;
    utterance.rate = this.rate;
    utterance.pitch = 1.05;

    let counted = false;
    utterance.onstart = () => {
      if (generation !== this.generation) return;
      counted = true;
      this.active += 1;
      if (this.active === 1) this.options.onSpeakingChange(true);
    };
    const finish = () => {
      if (!counted || generation !== this.generation) return;
      counted = false;
      this.active = Math.max(0, this.active - 1);
      if (this.active === 0) this.options.onSpeakingChange(false);
    };
    utterance.onend = finish;
    utterance.onerror = (event) => {
      // "interrupted"/"canceled" are our own stop(); anything else is real.
      if (event.error !== "interrupted" && event.error !== "canceled") {
        this.options.onError?.(event.error);
      }
      finish();
    };
    s.speak(utterance);
  }
}

/** Registry adapter so voices appear alongside future providers. */
export const windowsVoiceProvider: TextToSpeechProvider = {
  id: "windows",
  displayName: "Windows voices (built in)",
  isAvailable: async () => (await loadVoices()).length > 0,
  listVoices: async (): Promise<TextToSpeechVoice[]> =>
    (await loadVoices()).map((v) => ({ id: v.name, label: `${v.name} (${v.lang})` })),
  speak: (text, voiceId) =>
    new Promise<void>((resolve) => {
      const s = synth();
      if (!s) return resolve();
      const u = new SpeechSynthesisUtterance(speakable(text));
      const voice = s.getVoices().find((v) => v.name === voiceId);
      if (voice) u.voice = voice;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      s.speak(u);
    }),
  cancel: () => synth()?.cancel(),
};
