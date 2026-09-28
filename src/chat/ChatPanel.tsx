/**
 * The conversation surface.
 *
 * Sits beside the character rather than replacing her — she stays visible and
 * animating throughout, which is the whole point. Styled as one of AURA's own
 * glass panels, deliberately not as a messaging app.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { ChatEntry } from "@/types";
import type { ConversationStatus } from "./useConversation";

export interface ChatPanelProps {
  open: boolean;
  entries: ChatEntry[];
  status: ConversationStatus;
  /** Whether the selected engine (local model or Claude) can answer. */
  engineReady: boolean;
  /** Why it can't, when it can't. */
  engineDetail: string | null;
  screenEnabled: boolean;
  capturing: boolean;
  onSend: (text: string, options?: { withScreenshot?: boolean }) => void;
  onCancel: () => void;
  onClear: () => void;
  onMinimize: () => void;
  onOpenSettings: () => void;
}

export function ChatPanel({
  open,
  entries,
  status,
  engineReady,
  engineDetail,
  screenEnabled,
  capturing,
  onSend,
  onCancel,
  onClear,
  onMinimize,
  onOpenSettings,
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const busy = status !== "idle";

  // Stick to the bottom as replies stream in.
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [entries, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setConfirmClear(false);
  }, [open]);

  const submit = (options?: { withScreenshot?: boolean }) => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    onSend(text, options);
  };

  return (
    <section
      className="chat-panel"
      data-open={open}
      aria-hidden={!open}
      // Keeps the closed panel out of the tab order and off the a11y tree.
      inert={!open}
    >
      <header className="chat-panel__head">
        <div className="chat-panel__title">
          <span className="chat-panel__mark" aria-hidden="true" />
          <span>AURA</span>
          <span className="chat-panel__status" data-status={status}>
            {status === "thinking"
              ? "thinking"
              : status === "speaking"
                ? "speaking"
                : status === "sending"
                  ? "…"
                  : ""}
          </span>
        </div>
        <div className="chat-panel__actions">
          <button type="button" onClick={onOpenSettings} title="Settings">
            Settings
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirmClear) {
                onClear();
                setConfirmClear(false);
              } else {
                setConfirmClear(true);
              }
            }}
            title="Clear this conversation"
            data-armed={confirmClear}
          >
            {confirmClear ? "Sure?" : "Clear"}
          </button>
          <button type="button" onClick={onMinimize} title="Minimize" aria-label="Minimize">
            —
          </button>
        </div>
      </header>

      <div className="chat-panel__scroll" ref={scrollRef}>
        {entries.length === 0 && (
          <div className="chat-panel__empty">
            <p>Nothing said yet.</p>
            <p className="dim">
              {engineReady
                ? "Ask me something."
                : (engineDetail ?? "My model isn't available.") + " Check Settings → AI."}
            </p>
          </div>
        )}

        {entries.map((entry) => (
          <article
            key={entry.id}
            className="chat-line"
            data-role={entry.role}
            data-error={entry.error ?? undefined}
          >
            {entry.sawScreen && (
              <span className="chat-line__badge" title="This turn included a screenshot">
                screen
              </span>
            )}
            <p>
              {entry.content}
              {entry.streaming && <span className="chat-line__caret" aria-hidden="true" />}
            </p>
          </article>
        ))}

        {capturing && (
          <div className="chat-capture-notice" role="status">
            Capturing your screen…
          </div>
        )}
      </div>

      <footer className="chat-panel__compose">
        <textarea
          ref={inputRef}
          value={draft}
          rows={1}
          placeholder={engineReady ? "Say something…" : "My model isn't available"}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter is a newline.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="chat-panel__compose-actions">
          {screenEnabled && (
            <button
              type="button"
              className="ghost"
              disabled={busy || !draft.trim()}
              onClick={() => submit({ withScreenshot: true })}
              title="Capture your screen and send it with this message"
            >
              Look at screen
            </button>
          )}
          {busy ? (
            <button type="button" className="primary" onClick={onCancel}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={!draft.trim()}
              onClick={() => submit()}
            >
              Send
            </button>
          )}
        </div>
      </footer>
    </section>
  );
}
