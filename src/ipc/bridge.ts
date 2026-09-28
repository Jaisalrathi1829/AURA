/**
 * Typed wrappers over the Rust command surface.
 *
 * Nothing else in the frontend should call `invoke` directly — keeping it in
 * one file means the boundary between "things the UI can do" and "things only
 * Rust can do" stays legible.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type {
  ActiveApp,
  AiDelta,
  AiDone,
  AiError,
  AiPhase,
  EngineStatus,
  ModelOption,
  OllamaModel,
  OverlayLayout,
  ScreenCapture,
  Settings,
} from "@/types";

// ---------------------------------------------------------------- settings

export const getSettings = () => invoke<Settings>("get_settings");
export const saveSettings = (settings: Settings) =>
  invoke<Settings>("save_settings", { incoming: settings });
export const listModels = () => invoke<ModelOption[]>("list_models");

export const hasApiKey = () => invoke<boolean>("has_api_key");
export const setApiKey = (key: string) => invoke<boolean>("set_api_key", { key });
export const clearApiKey = () => invoke<void>("clear_api_key");
export const testApiKey = () => invoke<string>("test_api_key");
export const autostartIsEnabled = () => invoke<boolean>("autostart_is_enabled");

// ------------------------------------------------------------------ window

export const overlayLayout = () => invoke<OverlayLayout>("overlay_layout");
export const overlayReady = () => invoke<void>("overlay_ready");
export const setHitRect = (x: number, y: number, width: number, height: number) =>
  invoke<void>("set_hit_rect", { x, y, width, height });
export const setPointerOver = (over: boolean) =>
  invoke<void>("set_pointer_over", { over });
export const persistPosition = () => invoke<void>("persist_position");
export const setOverlayVisible = (visible: boolean) =>
  invoke<void>("set_overlay_visible", { visible });
export const startDrag = () => invoke<void>("start_drag");
export const openSettings = () => invoke<void>("open_settings");
export const closeSettings = () => invoke<void>("close_settings");
export const recenterOverlay = () => invoke<void>("recenter_overlay");

// ---------------------------------------------------------------------- ai

export interface SendMessageArgs {
  requestId: string;
  system: string;
  messages: { role: string; content: string }[];
  imagePngBase64?: string | null;
}

export const sendMessage = (request: SendMessageArgs) =>
  invoke<void>("send_message", { request });
export const cancelMessage = (requestId: string) =>
  invoke<void>("cancel_message", { requestId });
export const engineStatus = () => invoke<EngineStatus>("engine_status");
export const listOllamaModels = () => invoke<OllamaModel[]>("list_ollama_models");
export const testEngine = () => invoke<string>("test_engine");

// ------------------------------------------------------------------ system

export const captureScreen = () => invoke<ScreenCapture>("capture_screen");
export const showNotification = (title: string, body: string) =>
  invoke<void>("show_notification", { title, body });
export const getActiveApp = () => invoke<ActiveApp | null>("get_active_app");
/** Dev-only trace to the terminal running `tauri dev`; a no-op in release. */
export const trace = (message: string) =>
  invoke<void>("trace", { message }).catch(() => undefined);
export const restartApp = () => invoke<void>("restart_app");
export const quitApp = () => invoke<void>("quit_app");

// ------------------------------------------------------------------ events

export const onAiDelta = (fn: (p: AiDelta) => void): Promise<UnlistenFn> =>
  listen<AiDelta>("aura://ai-delta", (e) => fn(e.payload));
export const onAiPhase = (fn: (p: AiPhase) => void): Promise<UnlistenFn> =>
  listen<AiPhase>("aura://ai-phase", (e) => fn(e.payload));
export const onAiDone = (fn: (p: AiDone) => void): Promise<UnlistenFn> =>
  listen<AiDone>("aura://ai-done", (e) => fn(e.payload));
export const onAiError = (fn: (p: AiError) => void): Promise<UnlistenFn> =>
  listen<AiError>("aura://ai-error", (e) => fn(e.payload));

export const onSettingsChanged = (
  fn: (s: Settings) => void,
): Promise<UnlistenFn> =>
  listen<Settings>("aura://settings-changed", (e) => fn(e.payload));

export const onApiKeyChanged = (fn: (present: boolean) => void): Promise<UnlistenFn> =>
  listen<boolean>("aura://api-key-changed", (e) => fn(e.payload));

export const onActiveApp = (fn: (app: ActiveApp) => void): Promise<UnlistenFn> =>
  listen<ActiveApp>("aura://active-app", (e) => fn(e.payload));

export const onTrayCommand = (fn: (cmd: string) => void): Promise<UnlistenFn> =>
  listen<string>("aura://tray-command", (e) => fn(e.payload));

export const onScreenCapture = (
  fn: (stage: "start" | "end") => void,
): Promise<UnlistenFn> =>
  listen<"start" | "end">("aura://screen-capture", (e) => fn(e.payload));
