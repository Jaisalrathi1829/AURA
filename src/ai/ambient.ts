/**
 * One-shot Claude requests that are not part of the conversation.
 *
 * Used for live reactions to what you're doing: the same streaming machinery as
 * chat, but the result is collected into a string instead of a transcript entry.
 * These are strictly optional — every caller has a local fallback, so an absent
 * key, a network failure or a timeout costs nothing but a slightly duller line.
 */

import * as ipc from "@/ipc/bridge";

export interface AmbientRequest {
  system: string;
  prompt: string;
  timeoutMs?: number;
}

const newId = () =>
  `ambient-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Returns the produced line, or null if it failed, timed out, or the model
 * decided there was nothing worth saying.
 */
export async function requestAmbientLine({
  system,
  prompt,
  timeoutMs = 25_000,
}: AmbientRequest): Promise<string | null> {
  const requestId = newId();
  let text = "";

  const unlisteners: (() => void)[] = [];
  const cleanup = () => {
    for (const off of unlisteners) off();
    unlisteners.length = 0;
  };

  try {
    const settled = new Promise<string | null>((resolve) => {
      const timer = window.setTimeout(() => {
        void ipc.cancelMessage(requestId).catch(() => undefined);
        resolve(null);
      }, timeoutMs);

      const finish = (value: string | null) => {
        window.clearTimeout(timer);
        resolve(value);
      };

      void ipc
        .onAiDelta(({ id, text: chunk }) => {
          if (id === requestId) text += chunk;
        })
        .then((off) => unlisteners.push(off));

      void ipc
        .onAiDone(({ id }) => {
          if (id === requestId) finish(text.trim() || null);
        })
        .then((off) => unlisteners.push(off));

      void ipc
        .onAiError(({ id }) => {
          if (id === requestId) finish(null);
        })
        .then((off) => unlisteners.push(off));
    });

    // Listeners are registered asynchronously; send only once they are live, or
    // a fast reply could arrive before anything is listening for it.
    await Promise.resolve();
    await ipc.sendMessage({
      requestId,
      system,
      messages: [{ role: "user", content: prompt }],
    });

    const result = await settled;
    if (!result) return null;

    // The prompt lets the model decline; honour that rather than shipping the
    // literal token to the user.
    const cleaned = result.replace(/^["']|["']$/g, "").trim();
    if (!cleaned || /^SKIP\b/i.test(cleaned)) return null;
    return cleaned;
  } catch {
    return null;
  } finally {
    cleanup();
  }
}
