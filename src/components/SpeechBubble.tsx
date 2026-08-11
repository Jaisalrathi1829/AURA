/**
 * The small line AURA says without the conversation being open.
 *
 * Dismisses itself on a duration scaled to reading speed, and gets out of the
 * way the moment the user clicks through to the full conversation.
 */

import { useEffect, useRef } from "react";

export interface SpeechBubbleProps {
  text: string;
  /** Bumped by the host to restart the dismissal timer for a repeated line. */
  token: number;
  onDismiss: () => void;
  onOpen: () => void;
}

/** ~14 characters per second, floored and capped at something humane. */
function readingTime(text: string): number {
  return Math.min(14_000, Math.max(3800, (text.length / 14) * 1000));
}

export function SpeechBubble({ text, token, onDismiss, onOpen }: SpeechBubbleProps) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const timer = window.setTimeout(() => dismissRef.current(), readingTime(text));
    return () => window.clearTimeout(timer);
  }, [text, token]);

  return (
    <div className="speech-bubble" role="status">
      <button
        type="button"
        className="speech-bubble__body"
        onClick={onOpen}
        title="Open the conversation"
      >
        {text}
      </button>
      <button
        type="button"
        className="speech-bubble__close"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        ×
      </button>
      <span className="speech-bubble__tail" aria-hidden="true" />
    </div>
  );
}
