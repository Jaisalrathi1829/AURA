/** Shared types. Mirrors the serde shapes on the Rust side. */

export type ResponseLength = "brief" | "normal" | "detailed";
export type Effort = "low" | "medium" | "high";
export type RendererId = "vector" | "video";
/** How AURA responds to you switching applications. */
export type AppReactionMode = "off" | "local" | "claude";

export interface Settings {
  // General
  startWithWindows: boolean;
  alwaysOnTop: boolean;
  characterScale: number;
  rememberPosition: boolean;
  rememberSize: boolean;
  position: [number, number] | null;
  size: [number, number] | null;
  clickThroughEmpty: boolean;

  // AI
  model: string;
  responseLength: ResponseLength;
  effort: Effort;
  personaNote: string;
  userName: string;

  // Behavior
  proactiveEnabled: boolean;
  proactiveMinMinutes: number;
  proactiveMaxMinutes: number;
  quotesEnabled: boolean;
  quoteIntervalMinutes: number;
  quietHoursEnabled: boolean;
  quietHoursStart: number;
  quietHoursEnd: number;
  notificationsEnabled: boolean;
  proactiveAsNotification: boolean;
  appReactionMode: AppReactionMode;

  // Privacy
  appAwarenessEnabled: boolean;
  screenCaptureEnabled: boolean;
  storeConversation: boolean;

  // Appearance
  renderer: RendererId;
  uiOpacity: number;
  animationIntensity: number;
  greetingOnStart: boolean;

  // Voice
  voiceEnabled: boolean;
  ttsProvider: string;
  sttProvider: string;
}

export interface ModelOption {
  id: string;
  label: string;
  inputPrice: number;
  outputPrice: number;
  supportsEffort: boolean;
  thinks: boolean;
  note: string;
}

export interface OverlayLayout {
  panelWidth: number;
  characterWidth: number;
  characterHeight: number;
  windowWidth: number;
  windowHeight: number;
}

export interface ActiveApp {
  exe: string;
  label: string;
  category: string;
}

export type AiErrorKind =
  | "no-key"
  | "auth"
  | "rate-limit"
  | "overloaded"
  | "network"
  | "timeout"
  | "refusal"
  | "bad-request"
  | "malformed"
  | "cancelled";

export interface AiDelta {
  id: string;
  text: string;
}
export interface AiPhase {
  id: string;
  phase: "thinking" | "speaking";
}
export interface AiDone {
  id: string;
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
}
export interface AiError {
  id: string;
  kind: AiErrorKind;
  message: string;
}

export type MessageRole = "user" | "assistant";

export interface ChatEntry {
  id: string;
  role: MessageRole;
  content: string;
  /** Set while a reply is still streaming in. */
  streaming?: boolean;
  /** Non-fatal note rendered inline, e.g. an offline explanation. */
  error?: AiErrorKind;
  /** Marks a turn where AURA looked at the screen. */
  sawScreen?: boolean;
  at: number;
}
