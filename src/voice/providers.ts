/**
 * Voice provider interfaces.
 *
 * Speech output ships with a provider built on the Windows voices
 * (`webSpeech.ts`). Speech input does not yet; these interfaces let one be added
 * without touching the character system or the conversation flow — the same
 * arrangement the character renderers use.
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

/** Speech input has no provider yet; the built-in Windows voices handle output. */
export const STT_PROVIDERS: SpeechToTextProvider[] = [];
