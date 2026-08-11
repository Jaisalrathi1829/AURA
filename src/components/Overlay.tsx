/**
 * The desktop overlay — AURA's actual home.
 *
 * Wires the character, the conversation, the local schedulers and the Windows
 * integrations together. Everything visible lives inside `.overlay-interactive`;
 * the rest of the window is transparent and clicks fall straight through to the
 * desktop (see `desktop/clickthrough.rs`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import * as ipc from "@/ipc/bridge";
import { requestAmbientLine } from "@/ai/ambient";
import { buildSystemPrompt } from "@/ai/personality";
import { CharacterAnimation } from "@/character/CharacterAnimation";
import { CharacterStateMachine } from "@/character/CharacterStateMachine";
import { ChatPanel } from "@/chat/ChatPanel";
import { useConversation } from "@/chat/useConversation";
import { ActivityTracker } from "@/desktop/awareness";
import { ProactiveScheduler, type ProactiveLine } from "@/scheduler/proactive";
import {
  buildReactionPrompt,
  decideReaction,
  describeActivity,
} from "@/scheduler/reactions";
import type { OverlayLayout, Settings } from "@/types";

import { CharacterStage } from "./CharacterStage";
import { SpeechBubble } from "./SpeechBubble";

/** Movement past this many pixels turns a click into a window drag. */
const DRAG_THRESHOLD = 4;
/** Silence after which AURA dozes off. */
const SLEEP_AFTER_MS = 12 * 60 * 1000;
/** Floor between spoken reactions to app switches, per mode. Claude-written
 *  lines are rarer because each one costs credit. */
const REACTION_COOLDOWN_MS = { local: 6 * 60 * 1000, claude: 14 * 60 * 1000 };
/** Apps are opened in bursts; ignore anything the user leaves immediately. */
const REACTION_SETTLE_MS = 2500;

export function Overlay() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [layout, setLayout] = useState<OverlayLayout | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [bubble, setBubble] = useState<{ text: string; token: number } | null>(null);
  const [capturing, setCapturing] = useState(false);

  const machine = useMemo(() => new CharacterStateMachine(), []);
  const animation = useMemo(() => new CharacterAnimation(machine), [machine]);
  const activity = useMemo(() => new ActivityTracker(), []);

  const interactiveRef = useRef<HTMLDivElement | null>(null);
  const characterRef = useRef<HTMLDivElement | null>(null);
  const schedulerRef = useRef<ProactiveScheduler | null>(null);
  const lastInteraction = useRef(Date.now());
  const lastReactionAt = useRef(0);
  const reactionTimer = useRef<number | null>(null);
  const dragState = useRef<{ x: number; y: number; dragging: boolean } | null>(null);
  const chatOpenRef = useRef(false);
  chatOpenRef.current = chatOpen;

  const settingsRef = useRef<Settings | null>(null);
  settingsRef.current = settings;

  const currentActivity = useCallback(
    () => (settingsRef.current?.appAwarenessEnabled ? describeActivity(activity.snapshot()) : null),
    [activity],
  );

  // ---- conversation -----------------------------------------------------
  const conversation = useConversation({
    settings,
    describeActivity: currentActivity,
    onPhase: (status) => {
      // The character's state is the visible half of the request lifecycle.
      if (status === "sending" || status === "thinking") {
        machine.set("THINKING");
        animation.setSpeaking(false);
      } else if (status === "speaking") {
        machine.set("TALKING");
        animation.setSpeaking(true);
      } else {
        animation.setSpeaking(false);
        machine.set("IDLE", { force: true });
      }
    },
  });

  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;

  const noteInteraction = useCallback(() => {
    lastInteraction.current = Date.now();
    activity.noteInteraction();
    if (machine.getState() === "SLEEPING") {
      machine.set("IDLE", { force: true });
      animation.blinkNow(2);
    }
    schedulerRef.current?.noteInteraction();
  }, [machine, animation, activity]);

  // ---- bootstrap --------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // If any of this fails the overlay would otherwise render nothing at all
      // and look like a crash, so the failure is surfaced on screen instead.
      let loaded: Settings;
      let measured: OverlayLayout;
      let keyPresent: boolean;
      try {
        [loaded, measured, keyPresent] = await Promise.all([
          ipc.getSettings(),
          ipc.overlayLayout(),
          ipc.hasApiKey(),
        ]);
      } catch (e) {
        if (!cancelled) setBootError(String(e));
        await ipc.overlayReady().catch(() => undefined);
        return;
      }
      if (cancelled) return;
      setSettings(loaded);
      setLayout(measured);
      setHasKey(keyPresent);
      animation.setIntensity(loaded.animationIntensity);
      animation.start();

      await ipc.overlayReady();
      // Nothing is under the pointer yet, so start in pass-through.
      await ipc.setPointerOver(false).catch(() => undefined);

      if (loaded.appAwarenessEnabled) {
        const app = await ipc.getActiveApp().catch(() => null);
        // Seed the tracker without reacting — whatever was already in front
        // when AURA started is not something the user just did.
        if (!cancelled && app) activity.record(app);
      }
    })();

    return () => {
      cancelled = true;
      animation.stop();
    };
  }, [animation]);

  // ---- react to settings changes from the settings window ---------------
  useEffect(() => {
    const pending = ipc.onSettingsChanged(async (next) => {
      setSettings(next);
      animation.setIntensity(next.animationIntensity);
      setLayout(await ipc.overlayLayout());
      schedulerRef.current?.update(next);
    });
    return () => void pending.then((off) => off());
  }, [animation]);

  useEffect(() => {
    const pending = ipc.onApiKeyChanged(setHasKey);
    return () => void pending.then((off) => off());
  }, []);

  // ---- screen capture indicator -----------------------------------------
  useEffect(() => {
    const pending = ipc.onScreenCapture((stage) => setCapturing(stage === "start"));
    return () => void pending.then((off) => off());
  }, []);

  // ---- proactive scheduler ----------------------------------------------
  const speakLine = useCallback(
    (line: ProactiveLine) => {
      const current = settings;
      // A line delivered while she is on screen belongs in a bubble; one
      // delivered while hidden belongs in a toast, or nowhere.
      const hidden = document.hidden;
      if (current?.proactiveAsNotification || hidden) {
        if (current?.notificationsEnabled) {
          void ipc.showNotification("AURA", line.text).catch(() => undefined);
        }
        if (hidden) return;
      }
      setBubble({ text: line.text, token: Date.now() });
      machine.set(line.kind === "quote" ? "CURIOUS" : "TALKING");
      animation.setSpeaking(true);
      window.setTimeout(() => animation.setSpeaking(false), 1200);
      conversationRef.current.pushAssistantLine(line.text);
    },
    [settings, machine, animation],
  );

  const speakRef = useRef(speakLine);
  speakRef.current = speakLine;

  // ---- reacting to what you open ----------------------------------------
  // The foreground hook fires on every focus change, including the flicker as
  // an app launches, so a reaction waits for the switch to settle and then
  // goes through one decision path whether the line is local or Claude's.
  useEffect(() => {
    const pending = ipc.onActiveApp((app) => {
      const current = settingsRef.current;
      if (!current?.appAwarenessEnabled) return;

      const context = activity.record(app);
      schedulerRef.current?.setActiveApp(app);

      const mode = current.appReactionMode;
      if (mode === "off") return;

      if (reactionTimer.current !== null) window.clearTimeout(reactionTimer.current);
      reactionTimer.current = window.setTimeout(async () => {
        reactionTimer.current = null;

        // Don't talk over the user, and honour quiet hours.
        if (chatOpenRef.current || conversationRef.current.busy) {
          void ipc.trace(`reaction skipped: busy (${app.exe})`);
          return;
        }
        if (schedulerRef.current?.isQuiet()) {
          void ipc.trace(`reaction skipped: quiet hours (${app.exe})`);
          return;
        }

        const now = Date.now();
        const cooldown = REACTION_COOLDOWN_MS[mode];
        if (now - lastReactionAt.current < cooldown) {
          const left = Math.round((cooldown - (now - lastReactionAt.current)) / 1000);
          void ipc.trace(`reaction skipped: cooldown ${left}s (${app.exe})`);
          return;
        }

        // The user may have moved on during the settle delay.
        const settled = activity.snapshot();
        if (settled.app?.exe !== app.exe) return;

        const decision = decideReaction(
          { ...context, dwellMs: settled.dwellMs },
          { hour: new Date().getHours(), chattiness: mode === "claude" ? 0.55 : 0.35 },
        );
        void ipc.trace(
          `reaction ${app.exe}/${app.category}: reason=${decision.reason} ` +
            `switches=${context.recentSwitches} focus=${context.focusMinutes}m ` +
            `${decision.line ? "-> speaking" : "-> staying quiet"}`,
        );
        if (!decision.line) return;

        let line = decision.line;
        if (mode === "claude") {
          const written = await requestAmbientLine({
            system: buildSystemPrompt({
              settings: current,
              activity: describeActivity(settled),
              withScreenshot: false,
            }),
            prompt: buildReactionPrompt(settled, decision.reason),
          });
          // A failed or declined ambient request falls back to the local line
          // rather than going silent — the feature must not depend on the API.
          if (written === null && decision.reason === "opened") {
            void ipc.trace("reaction: claude declined and reason was weak — quiet");
            return;
          }
          if (written) line = written;
          else void ipc.trace("reaction: claude unavailable, using local line");
        }

        lastReactionAt.current = Date.now();
        void ipc.trace(`reaction said: ${line}`);
        speakRef.current({ text: line, kind: "app" });
      }, REACTION_SETTLE_MS);
    });

    return () => {
      void pending.then((off) => off());
      if (reactionTimer.current !== null) window.clearTimeout(reactionTimer.current);
    };
  }, [activity]);

  useEffect(() => {
    if (!settings) return;
    if (schedulerRef.current) {
      schedulerRef.current.update(settings);
      return;
    }
    const scheduler = new ProactiveScheduler(settings, {
      speak: (line) => speakRef.current(line),
      isBusy: () => chatOpenRef.current || conversationRef.current.busy,
    });
    schedulerRef.current = scheduler;
    scheduler.start();

    const greeting = scheduler.greeting();
    if (greeting) {
      // Let the entrance animation land before she says anything.
      window.setTimeout(() => speakRef.current(greeting), 1400);
    }

    return () => {
      scheduler.dispose();
      schedulerRef.current = null;
    };
    // Intentionally only on first settings load; later changes go through
    // `update` above so the schedule is not restarted on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings !== null]);

  // ---- drift into sleep --------------------------------------------------
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (conversationRef.current.busy || chatOpenRef.current) return;
      if (Date.now() - lastInteraction.current < SLEEP_AFTER_MS) return;
      if (machine.getState() === "SLEEPING") return;
      machine.set("SLEEPING", { force: true });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [machine]);

  // ---- pause the loop when hidden ----------------------------------------
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) animation.stop();
      else animation.start();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [animation]);

  // ---- publish the hit rectangle ----------------------------------------
  const publishHitRect = useCallback(() => {
    const node = interactiveRef.current;
    const character = characterRef.current;
    if (!node || !character) return;

    // When the panel is closed only the character (and any bubble) should be
    // clickable; the rest of the window must stay desktop.
    const source = chatOpenRef.current ? node : character;
    const box = source.getBoundingClientRect();
    void ipc
      .setHitRect(box.left, box.top, box.width, box.height)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    publishHitRect();
    const observer = new ResizeObserver(publishHitRect);
    if (interactiveRef.current) observer.observe(interactiveRef.current);
    window.addEventListener("resize", publishHitRect);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", publishHitRect);
    };
  }, [publishHitRect, chatOpen, bubble, layout]);

  // ---- tray commands -----------------------------------------------------
  useEffect(() => {
    const pending = ipc.onTrayCommand((command) => {
      noteInteraction();
      if (command === "talk") {
        setChatOpen(true);
        machine.set("LISTENING");
      } else if (command === "look") {
        setChatOpen(true);
        void conversationRef.current.send("What am I looking at?", {
          withScreenshot: true,
        });
      }
    });
    return () => void pending.then((off) => off());
  }, [machine, noteInteraction]);

  // ---- character interaction --------------------------------------------
  const openChat = useCallback(() => {
    noteInteraction();
    setBubble(null);
    setChatOpen(true);
    machine.set("LISTENING");
    animation.blinkNow();
  }, [machine, animation, noteInteraction]);

  const onCharacterPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return;
    dragState.current = { x: event.clientX, y: event.clientY, dragging: false };
  }, []);

  const onCharacterPointerMove = useCallback((event: React.PointerEvent) => {
    const state = dragState.current;
    if (!state || state.dragging) return;
    if (
      Math.abs(event.clientX - state.x) < DRAG_THRESHOLD &&
      Math.abs(event.clientY - state.y) < DRAG_THRESHOLD
    ) {
      return;
    }
    state.dragging = true;
    // The OS takes over the pointer from here, so pointerup never arrives —
    // persist shortly after the drag can plausibly have finished.
    void ipc.startDrag().catch(() => undefined);
    window.setTimeout(() => {
      void ipc.persistPosition().catch(() => undefined);
      dragState.current = null;
    }, 900);
  }, []);

  const onCharacterClick = useCallback(() => {
    if (dragState.current?.dragging) {
      dragState.current = null;
      return;
    }
    dragState.current = null;
    if (chatOpen) {
      setChatOpen(false);
      machine.set("IDLE", { force: true });
    } else {
      openChat();
    }
  }, [chatOpen, machine, openChat]);

  if (bootError) {
    return (
      <div className="overlay-root">
        <div className="boot-error" role="alert">
          <strong>AURA couldn&apos;t start properly.</strong>
          <p>{bootError}</p>
          <button type="button" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!settings || !layout) {
    // Nothing to show yet; the window is still hidden at this point.
    return null;
  }

  return (
    <div className="overlay-root" data-chat-open={chatOpen}>
      <div
        ref={interactiveRef}
        className="overlay-interactive"
        onPointerEnter={() => {
          void ipc.setPointerOver(true).catch(() => undefined);
        }}
        onPointerLeave={() => {
          if (!chatOpenRef.current) {
            void ipc.setPointerOver(false).catch(() => undefined);
          }
        }}
      >
        <ChatPanel
          open={chatOpen}
          entries={conversation.entries}
          status={conversation.status}
          hasApiKey={hasKey}
          screenEnabled={settings.screenCaptureEnabled}
          capturing={capturing}
          onSend={(text, options) => {
            noteInteraction();
            void conversation.send(text, options);
          }}
          onCancel={conversation.cancel}
          onClear={conversation.clear}
          onMinimize={() => {
            setChatOpen(false);
            machine.set("IDLE", { force: true });
            void ipc.setPointerOver(false).catch(() => undefined);
          }}
          onOpenSettings={() => void ipc.openSettings().catch(() => undefined)}
        />

        <div className="character-column" style={{ opacity: settings.uiOpacity }}>
          {bubble && !chatOpen && (
            <SpeechBubble
              text={bubble.text}
              token={bubble.token}
              onDismiss={() => setBubble(null)}
              onOpen={openChat}
            />
          )}

          <div
            ref={characterRef}
            className="character-holder"
            onPointerDown={onCharacterPointerDown}
            onPointerMove={onCharacterPointerMove}
            title="Click to talk · drag to move"
          >
            <CharacterStage
              machine={machine}
              animation={animation}
              rendererId={settings.renderer}
              width={layout.characterWidth}
              height={layout.characterHeight}
              intensity={settings.animationIntensity}
              onActivate={onCharacterClick}
            />

            <div className="character-quick">
              <button
                type="button"
                title="Settings"
                onClick={() => void ipc.openSettings().catch(() => undefined)}
              >
                ⚙
              </button>
              <button
                type="button"
                title="Hide AURA (restore from the tray)"
                onClick={() => void ipc.setOverlayVisible(false).catch(() => undefined)}
              >
                ×
              </button>
            </div>
          </div>
        </div>
      </div>

      {capturing && (
        <div className="capture-flash" aria-hidden="true">
          <span>Capturing your screen</span>
        </div>
      )}
    </div>
  );
}
