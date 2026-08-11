/**
 * Voice provider interfaces.
 *
 * Voice is **not implemented** in this version. These interfaces exist so that
 * adding speech later is a matter of writing a provider and registering it,
 * without touching the character system or the conversation flow — the same
 * arrangement the character renderers use.
 *
 * The Settings window shows voice controls as explicitly disabled rather than
 * as buttons that silently do nothing.
 */

export interface SpeechToTextResult {
  text: string;
  /** 0..1 where the provider reports it. */
  confidence?: number;
  final: boolean;
}

export interface SpeechToTextProvider {
  id: string;
  displayName: string;
  isAvailable(): Promise<boolean>;
  /** Begin listening. Resolve with a stop function. */
  start(onResult: (result: SpeechToTextResult) => void): Promise<() => void>;
}

export interface TextToSpeechVoice {
  id: string;
  label: string;
}

export interface TextToSpeechProvider {
  id: string;
  displayName: string;
  isAvailable(): Promise<boolean>;
  listVoices(): Promise<TextToSpeechVoice[]>;
  /**
   * Speak `text`. Resolves when playback finishes so the character can hold
   * the TALKING state for exactly as long as audio is playing.
   */
  speak(text: string, voiceId?: string): Promise<void>;
  cancel(): void;
}

/** Registries, deliberately empty until a provider ships. */
export const STT_PROVIDERS: SpeechToTextProvider[] = [];
export const TTS_PROVIDERS: TextToSpeechProvider[] = [];
