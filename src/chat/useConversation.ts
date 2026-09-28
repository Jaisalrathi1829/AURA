/**
 * Conversation state.
 *
 * Owns the transcript, the in-flight request, and the streamed assembly of
 * AURA's reply. Nothing here talks to the network — it hands a request to Rust
 * and reacts to the events that come back.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import * as ipc from "@/ipc/bridge";
import {
  buildSystemPrompt,
  trimHistory,
  withStyleExamples,
  type ScreenMode,
} from "@/ai/personality";
import type { AiErrorKind, ChatEntry, Settings } from "@/types";

const STORAGE_KEY = "aura.conversation.v1";
const MAX_STORED = 40;

export type ConversationStatus = "idle" | "sending" | "thinking" | "speaking";

/** In-character phrasing for each failure mode. A stack trace breaks the illusion. */
const ERROR_TEXT: Record<AiErrorKind, string> = {
  "no-key": "I don't have an API key yet. Add one in Settings and we can talk properly.",
  auth: "That key isn't being accepted. Worth checking it in Settings.",
  "rate-limit": "Rate limited. Give it a minute and ask me again.",
  overloaded: "The API is struggling right now. Try again shortly.",
  network: "I can't reach my model. I'm still here, just not clever at the moment.",
  timeout: "That took too long and I gave up. Ask again?",
  refusal: "I'd rather not answer that one.",
  "bad-request": "Something about that request was malformed. Check the model in Settings.",
  malformed: "I got a reply I couldn't read. Try once more.",
  cancelled: "Stopped.",
};

/** Failures where the engine's message says what to fix better than we can. */
const PREFER_ENGINE_MESSAGE = new Set<AiErrorKind>(["network", "bad-request", "malformed"]);

const newId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function loadStored(): ChatEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Anything still marked streaming was interrupted by a restart.
    return (parsed as ChatEntry[]).map((entry) => ({ ...entry, streaming: false }));
  } catch {
    return [];
  }
}

export interface UseConversationOptions {
  /** Null until settings have loaded; sending is inert until then. */
  settings: Settings | null;
  /** Desktop context sentence, re-read at send time so it is never stale. */
  describeActivity: () => string | null;
  /** Notified when AURA starts/stops producing text, to drive the character. */
  onPhase?: (status: ConversationStatus) => void;
  /** Each chunk of reply text as it streams — the voice follows along. */
  onReplyText?: (text: string) => void;
  /** The reply finished (or failed); flush anything the voice is holding. */
  onReplyEnd?: () => void;
}

export function useConversation({
  settings,
  describeActivity,
  onPhase,
  onReplyText,
  onReplyEnd,
}: UseConversationOptions) {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [status, setStatus] = useState<ConversationStatus>("idle");
  const hydrated = useRef(false);

  const activeRequest = useRef<string | null>(null);
  const activeReply = useRef<string | null>(null);
  // Read inside event handlers that are registered once, so they must not
  // close over stale props.
  const settingsRef = useRef(settings);
  const activityRef = useRef(describeActivity);
  const phaseRef = useRef(onPhase);

  settingsRef.current = settings;
  activityRef.current = describeActivity;
  phaseRef.current = onPhase;
  const replyTextRef = useRef(onReplyText);
  const replyEndRef = useRef(onReplyEnd);
  replyTextRef.current = onReplyText;
  replyEndRef.current = onReplyEnd;

  const applyStatus = useCallback((next: ConversationStatus) => {
    setStatus(next);
    phaseRef.current?.(next);
  }, []);

  // ---- persistence ------------------------------------------------------
  // Restore only once settings are known, so a user who has storage turned off
  // never sees an old transcript reappear on launch.
  useEffect(() => {
    if (!settings || hydrated.current) return;
    hydrated.current = true;
    if (settings.storeConversation) setEntries(loadStored());
    else localStorage.removeItem(STORAGE_KEY);
  }, [settings]);

  useEffect(() => {
    if (!settings || !hydrated.current) return;
    if (!settings.storeConversation) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_STORED)));
    } catch {
      /* quota exhausted — the transcript is a convenience, not state we owe */
    }
  }, [entries, settings]);

  // ---- streaming events -------------------------------------------------
  useEffect(() => {
    const unlisteners: Promise<() => void>[] = [];

    unlisteners.push(
      ipc.onAiPhase(({ id, phase }) => {
        if (id !== activeRequest.current) return;
        applyStatus(phase === "speaking" ? "speaking" : "thinking");
      }),
    );

    unlisteners.push(
      ipc.onAiDelta(({ id, text }) => {
        if (id !== activeRequest.current) return;
        const replyId = activeReply.current;
        if (!replyId) return;
        replyTextRef.current?.(text);
        setEntries((prev) =>
          prev.map((entry) =>
            entry.id === replyId
              ? { ...entry, content: entry.content + text }
              : entry,
          ),
        );
      }),
    );

    unlisteners.push(
      ipc.onAiDone(({ id }) => {
        if (id !== activeRequest.current) return;
        const replyId = activeReply.current;
        setEntries((prev) =>
          prev.map((entry) =>
            entry.id === replyId ? { ...entry, streaming: false } : entry,
          ),
        );
        replyEndRef.current?.();
        activeRequest.current = null;
        activeReply.current = null;
        applyStatus("idle");
      }),
    );

    unlisteners.push(
      ipc.onAiError(({ id, kind, message }) => {
        if (id !== activeRequest.current) return;
        const replyId = activeReply.current;
        setEntries((prev) =>
          prev.map((entry) =>
            entry.id === replyId
              ? {
                  ...entry,
                  // Keep any partial text. Otherwise prefer the engine's own
                  // explanation (e.g. "Ollama isn't answering") over the
                  // generic line when it has one.
                  content:
                    entry.content ||
                    (PREFER_ENGINE_MESSAGE.has(kind) && message ? message : ERROR_TEXT[kind]) ||
                    message,
                  streaming: false,
                  error: kind,
                }
              : entry,
          ),
        );
        replyEndRef.current?.();
        activeRequest.current = null;
        activeReply.current = null;
        applyStatus("idle");
      }),
    );

    return () => {
      for (const pending of unlisteners) void pending.then((off) => off());
    };
  }, [applyStatus]);

  // ---- sending ----------------------------------------------------------
  const send = useCallback(
    async (text: string, options: { withScreenshot?: boolean } = {}) => {
      const current = settingsRef.current;
      const trimmedText = text.trim();
      if (!trimmedText || activeRequest.current || !current) return;

      const requestId = newId();
      const replyId = newId();
      const withScreenshot = options.withScreenshot === true;

      const userEntry: ChatEntry = {
        id: newId(),
        role: "user",
        content: trimmedText,
        sawScreen: withScreenshot,
        at: Date.now(),
      };
      const replyEntry: ChatEntry = {
        id: replyId,
        role: "assistant",
        content: "",
        streaming: true,
        at: Date.now(),
      };

      activeRequest.current = requestId;
      activeReply.current = replyId;
      applyStatus("sending");

      // Snapshot history *before* adding this turn, then append it, so the
      // request matches exactly what the user sees.
      let history: ChatEntry[] = [];
      setEntries((prev) => {
        history = prev;
        return [...prev, userEntry, replyEntry];
      });

      const failReply = (content: string) => {
        setEntries((prev) =>
          prev.map((entry) =>
            entry.id === replyId
              ? { ...entry, content, streaming: false, error: "bad-request" }
              : entry,
          ),
        );
        activeRequest.current = null;
        activeReply.current = null;
        applyStatus("idle");
      };

      // A model that can see gets the image. One that can't gets the screen's
      // text, read on this machine, folded into the message.
      let imagePngBase64: string | null = null;
      let screen: ScreenMode = null;
      let userContent = trimmedText;
      if (withScreenshot) {
        try {
          const [engine, shot] = await Promise.all([
            ipc.engineStatus().catch(() => null),
            ipc.captureScreen(),
          ]);
          if (engine?.vision) {
            imagePngBase64 = shot.pngBase64;
            screen = "image";
          } else if (shot.text) {
            screen = "text";
            userContent = `${trimmedText}\n\n<screen_text>\n${shot.text}</screen_text>`;
          } else {
            failReply(
              "I looked, but I couldn't make out any text on your screen, and my current model can't see images.",
            );
            return;
          }
        } catch (e) {
          failReply(`I couldn't capture the screen. ${String(e)}`);
          return;
        }
      }

      // Error explanations are AURA talking about herself, not conversation —
      // feeding them back would teach the model it said them.
      const turns = trimHistory(history.filter((entry) => !entry.error && entry.content)).map(
        (entry) => ({ role: entry.role, content: entry.content }),
      );
      turns.push({ role: "user", content: userContent });
      const payload = withStyleExamples(current, turns);

      try {
        await ipc.sendMessage({
          requestId,
          system: buildSystemPrompt({
            settings: current,
            activity: activityRef.current(),
            screen,
          }),
          messages: payload,
          imagePngBase64,
        });
      } catch (e) {
        failReply(`Something went wrong sending that. ${String(e)}`);
      }
    },
    [applyStatus],
  );

  const cancel = useCallback(() => {
    const id = activeRequest.current;
    if (!id) return;
    void ipc.cancelMessage(id);
  }, []);

  const clear = useCallback(() => {
    setEntries([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  /** Insert a line AURA said on her own initiative, so it joins the transcript. */
  const pushAssistantLine = useCallback((content: string) => {
    setEntries((prev) => [
      ...prev,
      { id: newId(), role: "assistant", content, at: Date.now() },
    ]);
  }, []);

  const lastAssistantLine = useMemo(() => {
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      if (entry?.role === "assistant" && entry.content) return entry;
    }
    return null;
  }, [entries]);

  return {
    entries,
    status,
    busy: status !== "idle",
    send,
    cancel,
    clear,
    pushAssistantLine,
    lastAssistantLine,
  };
}
