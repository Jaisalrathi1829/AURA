/**
 * The settings window.
 *
 * Changes apply immediately — there is no Save button, because a companion you
 * have to remember to commit changes to is a worse companion. Every write goes
 * through Rust, which applies the side effects and broadcasts to the overlay.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import * as ipc from "@/ipc/bridge";
import { RENDERER_LIST } from "@/character/renderers";
import type { EngineStatus, ModelOption, OllamaModel, RendererId, Settings } from "@/types";
import { chooseVoice, loadVoices, Speaker } from "@/voice/webSpeech";

import { NumberField, Row, Section, Select, Slider, Toggle } from "./controls";

const formatSize = (bytes: number) =>
  bytes > 0 ? ` · ${(bytes / 1024 ** 3).toFixed(1)} GB` : "";

/** Installed models, keeping the saved choice listed even if Ollama is down. */
function ollamaOptions(models: OllamaModel[], current: string) {
  const options = models.map((m) => ({
    value: m.name,
    label: `${m.name}${formatSize(m.sizeBytes)}${m.vision ? " · sees images" : ""}`,
  }));
  if (current && !models.some((m) => m.name === current)) {
    options.unshift({ value: current, label: `${current} (not found)` });
  }
  return options;
}

type Tab = "general" | "ai" | "behavior" | "privacy" | "appearance" | "voice";

const TABS: { id: Tab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "ai", label: "AI" },
  { id: "behavior", label: "Behavior" },
  { id: "privacy", label: "Privacy" },
  { id: "appearance", label: "Appearance" },
  { id: "voice", label: "Voice" },
];

const hour = (h: number) => `${String(h).padStart(2, "0")}:00`;

export function SettingsApp() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [tab, setTab] = useState<Tab>("general");

  const [keyPresent, setKeyPresent] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [keyStatus, setKeyStatus] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [rendererStatus, setRendererStatus] = useState<Record<string, string>>({});

  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const [engineTest, setEngineTest] = useState<string | null>(null);
  const [testingEngine, setTestingEngine] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [autoVoice, setAutoVoice] = useState<string | null>(null);

  // Engine status depends on the engine settings, so re-ask whenever they
  // change (after the debounced save has landed).
  const engineKey = settings
    ? `${settings.engine}|${settings.ollamaModel}|${settings.ollamaVisionModel}|${settings.ollamaUrl}|${settings.model}|${keyPresent}`
    : "";
  useEffect(() => {
    if (!engineKey) return;
    const timer = window.setTimeout(() => {
      void ipc.engineStatus().then(setEngineStatus).catch(() => setEngineStatus(null));
      void ipc.listOllamaModels().then(setOllamaModels).catch(() => setOllamaModels([]));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [engineKey]);

  useEffect(() => {
    void loadVoices().then((list) => {
      setVoices(list);
      setAutoVoice(chooseVoice(list, "")?.name ?? null);
    });
  }, []);

  // Debounce writes so dragging a slider doesn't hit disk on every frame.
  const pending = useRef<number | null>(null);

  useEffect(() => {
    void (async () => {
      const [loaded, list, present] = await Promise.all([
        ipc.getSettings(),
        ipc.listModels(),
        ipc.hasApiKey(),
      ]);
      setSettings(loaded);
      setModels(list);
      setKeyPresent(present);
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const entries = await Promise.all(
        RENDERER_LIST.map(async (renderer) => {
          const status = await renderer.probeAssets();
          return [renderer.id, status.detail] as const;
        }),
      );
      setRendererStatus(Object.fromEntries(entries));
    })();
  }, []);

  const update = (patch: Partial<Settings>) => {
    setSettings((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      if (pending.current !== null) window.clearTimeout(pending.current);
      pending.current = window.setTimeout(() => {
        void ipc.saveSettings(next).then((applied) => setSettings(applied));
      }, 160);
      return next;
    });
  };

  const activeModel = useMemo(
    () => models.find((m) => m.id === settings?.model),
    [models, settings?.model],
  );

  if (!settings) {
    return <div className="settings-loading">Loading…</div>;
  }

  return (
    <div className="settings-app">
      <header className="settings-head">
        <div className="settings-brand">
          <span className="settings-brand__mark" />
          <div>
            <h1>AURA</h1>
            <p>Adaptive User Responsive Assistant</p>
          </div>
        </div>
        <nav className="settings-tabs">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              data-active={tab === entry.id}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="settings-body">
        {tab === "general" && (
          <Section title="General">
            <Row label="Start with Windows">
              <Toggle
                checked={settings.startWithWindows}
                onChange={(startWithWindows) => update({ startWithWindows })}
              />
            </Row>
            <Row label="Always on top">
              <Toggle
                checked={settings.alwaysOnTop}
                onChange={(alwaysOnTop) => update({ alwaysOnTop })}
              />
            </Row>
            <Row
              label="Click through empty space"
              hint="Clicks anywhere except AURA go to the desktop behind her."
            >
              <Toggle
                checked={settings.clickThroughEmpty}
                onChange={(clickThroughEmpty) => update({ clickThroughEmpty })}
              />
            </Row>
            <Row label="Character size">
              <Slider
                value={settings.characterScale}
                min={0.6}
                max={1.8}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(characterScale) => update({ characterScale })}
              />
            </Row>
            <Row label="Remember position">
              <Toggle
                checked={settings.rememberPosition}
                onChange={(rememberPosition) => update({ rememberPosition })}
              />
            </Row>
            <Row label="Remember size">
              <Toggle
                checked={settings.rememberSize}
                onChange={(rememberSize) => update({ rememberSize })}
              />
            </Row>
            <Row label="Position" hint="Move AURA back to the bottom-right corner.">
              <button
                type="button"
                className="btn"
                onClick={() => void ipc.recenterOverlay()}
              >
                Reset
              </button>
            </Row>
          </Section>
        )}

        {tab === "ai" && (
          <>
            <Section title="Engine">
              <Row label="Thinks with">
                <Select
                  value={settings.engine}
                  options={[
                    { value: "ollama", label: "Local model (Ollama)" },
                    { value: "claude", label: "Claude API" },
                  ]}
                  onChange={(engine) => {
                    setEngineTest(null);
                    update({ engine });
                  }}
                />
              </Row>
              {engineStatus && (
                <p className="settings-note settings-note--tight">
                  <em>{engineStatus.ready ? "Ready." : "Not ready."}</em> {engineStatus.detail}
                </p>
              )}
              <div className="key-actions engine-test">
                <button
                  type="button"
                  className="btn"
                  disabled={testingEngine}
                  onClick={async () => {
                    setTestingEngine(true);
                    setEngineTest(
                      settings.engine === "ollama"
                        ? "Loading the model — the first time can take a little while…"
                        : "Testing…",
                    );
                    try {
                      setEngineTest(await ipc.testEngine());
                    } catch (e) {
                      setEngineTest(String(e));
                    } finally {
                      setTestingEngine(false);
                    }
                  }}
                >
                  Test engine
                </button>
                {engineTest && <span className="key-status">{engineTest}</span>}
              </div>
            </Section>

            {settings.engine === "ollama" && (
              <Section title="Local model">
                <p className="settings-note">
                  Runs on this machine through Ollama. Free, works offline, and
                  nothing you say — or anything on your screen — leaves the
                  computer.
                </p>
                <Row label="Model">
                  <Select
                    value={settings.ollamaModel}
                    options={ollamaOptions(ollamaModels, settings.ollamaModel)}
                    onChange={(ollamaModel) => update({ ollamaModel })}
                  />
                </Row>
                <Row
                  label="Seeing the screen"
                  hint={
                    ollamaModels.some((m) => m.vision)
                      ? "A vision model receives the actual screenshot. Without one, the screen's text is read on-device and given to her model."
                      : "None of your installed models can see images, so the screen's text is read on-device and given to her model. Install a vision model in Ollama (e.g. qwen2.5vl:3b) to let her see layout and images too."
                  }
                >
                  <Select
                    value={settings.ollamaVisionModel}
                    options={[
                      { value: "", label: "Read text on screen (OCR)" },
                      ...ollamaModels
                        .filter((m) => m.vision)
                        .map((m) => ({ value: m.name, label: `See it — ${m.name}` })),
                    ]}
                    onChange={(ollamaVisionModel) => update({ ollamaVisionModel })}
                  />
                </Row>
                <Row label="Ollama address" hint="Only this computer is allowed.">
                  <input
                    className="text-field"
                    value={settings.ollamaUrl}
                    spellCheck={false}
                    onChange={(event) => update({ ollamaUrl: event.target.value })}
                  />
                </Row>
              </Section>
            )}

            {settings.engine === "claude" && (
            <Section title="Claude API key">
              <p className="settings-note">
                Stored in the Windows Credential Manager, never in a settings file
                and never sent to the interface — only the Rust side of AURA can
                read it. Get one at console.anthropic.com.
              </p>
              <div className="key-row">
                <input
                  type="password"
                  placeholder={keyPresent ? "•••••••••••• (saved)" : "sk-ant-…"}
                  value={keyDraft}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setKeyDraft(event.target.value)}
                />
                <button
                  type="button"
                  className="btn primary"
                  disabled={!keyDraft.trim()}
                  onClick={async () => {
                    const present = await ipc.setApiKey(keyDraft.trim());
                    setKeyDraft("");
                    setKeyPresent(present);
                    setKeyStatus(present ? "Key saved." : "Key cleared.");
                  }}
                >
                  Save
                </button>
              </div>
              <div className="key-actions">
                <button
                  type="button"
                  className="btn"
                  disabled={!keyPresent || testing}
                  onClick={async () => {
                    setTesting(true);
                    setKeyStatus("Testing…");
                    try {
                      setKeyStatus(await ipc.testApiKey());
                    } catch (e) {
                      setKeyStatus(String(e));
                    } finally {
                      setTesting(false);
                    }
                  }}
                >
                  Test key
                </button>
                <button
                  type="button"
                  className="btn danger"
                  disabled={!keyPresent}
                  onClick={async () => {
                    await ipc.clearApiKey();
                    setKeyPresent(false);
                    setKeyStatus("Key removed.");
                  }}
                >
                  Remove
                </button>
                {keyStatus && <span className="key-status">{keyStatus}</span>}
              </div>
            </Section>
            )}

            <Section title="Replies">
              {settings.engine === "claude" && (
              <Row label="Claude model">
                <Select
                  value={settings.model}
                  options={models.map((m) => ({ value: m.id, label: m.label }))}
                  onChange={(model) => update({ model })}
                />
              </Row>
              )}
              {settings.engine === "claude" && activeModel && (
                <p className="settings-note">
                  {activeModel.note} ${activeModel.inputPrice.toFixed(2)} per million
                  input tokens, ${activeModel.outputPrice.toFixed(2)} per million
                  output.
                  {activeModel.thinks
                    ? " Thinks before answering, which is why there is a short pause."
                    : " Answers immediately, without a reasoning pass."}
                </p>
              )}
              <Row label="Response length">
                <Select
                  value={settings.responseLength}
                  options={[
                    { value: "brief", label: "Brief" },
                    { value: "normal", label: "Normal" },
                    { value: "detailed", label: "Detailed" },
                  ]}
                  onChange={(responseLength) => update({ responseLength })}
                />
              </Row>
              {settings.engine === "claude" && (
              <Row
                label="Effort"
                hint={
                  activeModel?.supportsEffort
                    ? "Higher effort means more thinking, more cost, slower replies."
                    : "This model does not support the effort setting."
                }
              >
                <Select
                  value={settings.effort}
                  options={[
                    { value: "low", label: "Low" },
                    { value: "medium", label: "Medium" },
                    { value: "high", label: "High" },
                  ]}
                  onChange={(effort) => update({ effort })}
                />
              </Row>
              )}
            </Section>

            <Section title="Personality">
              <Row label="Your name" hint="Used so she can address you directly.">
                <input
                  className="text-field"
                  value={settings.userName}
                  placeholder="Optional"
                  onChange={(event) => update({ userName: event.target.value })}
                />
              </Row>
              <label className="settings-block">
                <span className="settings-row__label">
                  Personality notes
                  <small>
                    Added to her system prompt. Anything here takes precedence over
                    her defaults.
                  </small>
                </span>
                <textarea
                  className="text-field"
                  rows={4}
                  value={settings.personaNote}
                  placeholder="e.g. Be blunter. Assume I know the basics. Never apologise."
                  onChange={(event) => update({ personaNote: event.target.value })}
                />
              </label>
            </Section>
          </>
        )}

        {tab === "behavior" && (
          <>
            <Section title="Proactive messages">
              <Row
                label="Speak up occasionally"
                hint="All proactive lines are written locally. They cost nothing."
              >
                <Toggle
                  checked={settings.proactiveEnabled}
                  onChange={(proactiveEnabled) => update({ proactiveEnabled })}
                />
              </Row>
              <Row label="Minimum gap">
                <NumberField
                  value={settings.proactiveMinMinutes}
                  min={5}
                  max={720}
                  suffix="min"
                  onChange={(proactiveMinMinutes) => update({ proactiveMinMinutes })}
                />
              </Row>
              <Row label="Maximum gap">
                <NumberField
                  value={settings.proactiveMaxMinutes}
                  min={5}
                  max={1440}
                  suffix="min"
                  onChange={(proactiveMaxMinutes) => update({ proactiveMaxMinutes })}
                />
              </Row>
              <Row label="Deliver as notification" hint="Instead of a speech bubble.">
                <Toggle
                  checked={settings.proactiveAsNotification}
                  onChange={(proactiveAsNotification) =>
                    update({ proactiveAsNotification })
                  }
                />
              </Row>
            </Section>

            <Section title="Reacting to what you're doing">
              <p className="settings-note">
                AURA sees which application is in front, how long you have been
                in it, and whether you are focused or bouncing between windows.
                <strong> Written by her model</strong> means her engine (see the
                AI tab) writes each line from that situation, falling back to
                canned lines if it's unavailable. <strong>Canned</strong> uses
                her pre-written lines: instant, and less specific.
              </p>
              <Row
                label="Reactions"
                hint={
                  settings.appAwarenessEnabled
                    ? undefined
                    : "Turn on active application awareness in Privacy to enable this."
                }
              >
                <Select
                  value={settings.appReactionMode}
                  options={[
                    { value: "claude", label: "Written by her model" },
                    { value: "local", label: "Canned lines" },
                    { value: "off", label: "Off" },
                  ]}
                  onChange={(appReactionMode) => update({ appReactionMode })}
                />
              </Row>
              {settings.appReactionMode === "claude" && engineStatus && !engineStatus.ready && (
                <p className="settings-note settings-note--tight">
                  Her engine isn't available right now, so she will fall back to canned lines.
                </p>
              )}
            </Section>

            <Section title="Quotes">
              <Row label="Random quotes">
                <Toggle
                  checked={settings.quotesEnabled}
                  onChange={(quotesEnabled) => update({ quotesEnabled })}
                />
              </Row>
              <Row label="Roughly every">
                <NumberField
                  value={settings.quoteIntervalMinutes}
                  min={10}
                  max={1440}
                  suffix="min"
                  onChange={(quoteIntervalMinutes) => update({ quoteIntervalMinutes })}
                />
              </Row>
            </Section>

            <Section title="Quiet hours">
              <Row label="Stay quiet overnight">
                <Toggle
                  checked={settings.quietHoursEnabled}
                  onChange={(quietHoursEnabled) => update({ quietHoursEnabled })}
                />
              </Row>
              <Row label="From">
                <Select
                  value={String(settings.quietHoursStart)}
                  options={Array.from({ length: 24 }, (_, h) => ({
                    value: String(h),
                    label: hour(h),
                  }))}
                  onChange={(value) => update({ quietHoursStart: Number(value) })}
                />
              </Row>
              <Row label="Until">
                <Select
                  value={String(settings.quietHoursEnd)}
                  options={Array.from({ length: 24 }, (_, h) => ({
                    value: String(h),
                    label: hour(h),
                  }))}
                  onChange={(value) => update({ quietHoursEnd: Number(value) })}
                />
              </Row>
            </Section>

            <Section title="Notifications">
              <Row label="Windows notifications">
                <Toggle
                  checked={settings.notificationsEnabled}
                  onChange={(notificationsEnabled) => update({ notificationsEnabled })}
                />
              </Row>
            </Section>
          </>
        )}

        {tab === "privacy" && (
          <Section title="Privacy">
            <p className="settings-note">
              AURA never captures your screen unless you ask her to, never records
              audio, and never runs commands. Screenshots are held in memory for
              the length of one request and are never written to disk.
            </p>
            <Row
              label="Active application awareness"
              hint="She learns which app is in front — the executable name only, never window titles. Local; costs nothing."
            >
              <Toggle
                checked={settings.appAwarenessEnabled}
                onChange={(appAwarenessEnabled) => update({ appAwarenessEnabled })}
              />
            </Row>
            <Row
              label="Screen understanding"
              hint="Enables the 'Look at screen' action. Each use captures once and shows an on-screen indicator."
            >
              <Toggle
                checked={settings.screenCaptureEnabled}
                onChange={(screenCaptureEnabled) => update({ screenCaptureEnabled })}
              />
            </Row>
            <Row
              label="Store conversation"
              hint="Keeps recent messages so the thread survives a restart. Turning this off clears them."
            >
              <Toggle
                checked={settings.storeConversation}
                onChange={(storeConversation) => update({ storeConversation })}
              />
            </Row>
          </Section>
        )}

        {tab === "appearance" && (
          <Section title="Appearance">
            <Row label="Character">
              <Select
                value={settings.renderer}
                options={RENDERER_LIST.map((r) => ({
                  value: r.id as RendererId,
                  label: r.displayName,
                }))}
                onChange={(renderer) => update({ renderer })}
              />
            </Row>
            {RENDERER_LIST.map((renderer) => (
              <p key={renderer.id} className="settings-note settings-note--tight">
                <strong>{renderer.displayName}</strong> — {renderer.description}{" "}
                {rendererStatus[renderer.id] && (
                  <em>{rendererStatus[renderer.id]}</em>
                )}
              </p>
            ))}
            <Row label="Interface opacity">
              <Slider
                value={settings.uiOpacity}
                min={0.4}
                max={1}
                step={0.02}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(uiOpacity) => update({ uiOpacity })}
              />
            </Row>
            <Row
              label="Animation intensity"
              hint="Lower means stiller. Zero keeps her breathing and blinking only."
            >
              <Slider
                value={settings.animationIntensity}
                min={0}
                max={1}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(animationIntensity) => update({ animationIntensity })}
              />
            </Row>
            <Row label="Greet on start">
              <Toggle
                checked={settings.greetingOnStart}
                onChange={(greetingOnStart) => update({ greetingOnStart })}
              />
            </Row>
          </Section>
        )}

        {tab === "voice" && (
          <Section title="Voice">
            <p className="settings-note">
              She speaks her replies and remarks aloud with a voice built into
              Windows — local and free. Speech starts as soon as the first
              sentence arrives. Talking to her by voice isn't supported yet.
            </p>
            <Row label="Speak aloud">
              <Toggle
                checked={settings.voiceEnabled}
                onChange={(voiceEnabled) => update({ voiceEnabled })}
              />
            </Row>
            <Row
              label="Voice"
              hint={
                voices.length === 0
                  ? "No Windows voices found. Add one in Windows Settings → Time & language → Speech."
                  : "More voices can be added in Windows Settings → Time & language → Speech."
              }
            >
              <Select
                value={settings.voiceName}
                options={[
                  { value: "", label: `Automatic${autoVoice ? ` (${autoVoice})` : ""}` },
                  ...voices.map((v) => ({ value: v.name, label: `${v.name} — ${v.lang}` })),
                ]}
                onChange={(voiceName) => update({ voiceName })}
              />
            </Row>
            <Row label="Speed">
              <Slider
                value={settings.voiceRate}
                min={0.6}
                max={1.6}
                step={0.05}
                format={(v) => `${v.toFixed(2)}×`}
                onChange={(voiceRate) => update({ voiceRate })}
              />
            </Row>
            <Row label="Try it">
              <button
                type="button"
                className="btn"
                disabled={voices.length === 0}
                onClick={async () => {
                  const preview = new Speaker({ onSpeakingChange: () => undefined });
                  await preview.configure(true, settings.voiceName, settings.voiceRate);
                  preview.say("Hello. This is how I sound. Try not to be too disappointed.");
                }}
              >
                Play sample
              </button>
            </Row>
          </Section>
        )}
      </main>

      <footer className="settings-foot">
        <span>Changes apply immediately.</span>
        <div>
          <button type="button" className="btn" onClick={() => void ipc.restartApp()}>
            Restart AURA
          </button>
          <button type="button" className="btn" onClick={() => void ipc.closeSettings()}>
            Close
          </button>
        </div>
      </footer>
    </div>
  );
}
