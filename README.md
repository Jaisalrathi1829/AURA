# AURA

**A**daptive **U**ser **R**esponsive **A**ssistant — a persistent AI companion that
lives on your Windows desktop as a character you can talk to, not a chat window
you open.

AURA sits on top of the desktop with a genuinely transparent, frameless window.
She breathes, blinks, glances around, follows your cursor, notices which app
you're in, occasionally says something unprompted, and answers when you click
her. Claude is her intelligence layer; everything that doesn't need a model —
animation, scheduling, quotes, notifications, position, settings — runs locally
and costs nothing.

---

## Contents

- [Prerequisites](#prerequisites)
- [Development setup](#development-setup)
- [Configuring the API key](#configuring-the-api-key)
- [Building a Windows release](#building-a-windows-release)
- [Using AURA](#using-aura)
- [Settings reference](#settings-reference)
- [Privacy controls](#privacy-controls)
- [Supplying a character asset](#supplying-a-character-asset)
- [Architecture](#architecture)
- [Cost behaviour](#cost-behaviour)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Windows 10 1809+ / Windows 11 | Transparent overlay and tray need this or newer. |
| WebView2 Runtime | Preinstalled on Windows 11 and current Windows 10. |
| Node.js 20+ | Built and tested on Node 24. |
| Rust (stable, MSVC toolchain) | `rustup default stable-x86_64-pc-windows-msvc`. |
| Visual Studio Build Tools | The **Desktop development with C++** workload, for the linker. |
| A Claude API key | From [console.anthropic.com](https://console.anthropic.com). |

## Development setup

```bash
npm install
```

Run the app with the dev server and hot reload:

```bash
npm start
```

That is `tauri dev` — it starts Vite on port 5183 and launches the overlay
against it. Rust changes trigger a rebuild; frontend changes hot-reload.

Type-check and build the frontend on its own:

```bash
npm run build
```

Run the Rust unit tests (SSE framing, request shaping, app-name mapping):

```bash
cd src-tauri && cargo test
```

## Configuring the API key

The key is **never** placed in a settings file, an environment variable, or the
frontend bundle. It goes into the Windows Credential Manager and is read only
inside the Rust HTTP client.

1. Right-click the AURA tray icon → **Settings…**, or click the ⚙ on the character.
2. Open the **AI** tab.
3. Paste the key and press **Save**, then **Test key** to confirm it works.

To remove it: **Remove** in the same panel, or delete the
`com.aura.companion` generic credential in Windows Credential Manager.

Without a key AURA still starts, animates, shows quotes and notifications, and
tells you plainly that she has nothing to think with.

## Building a Windows release

```bash
npm run package
```

This produces:

- `src-tauri/target/release/AURA.exe` — the standalone executable
- `src-tauri/target/release/bundle/nsis/AURA_1.0.0_x64-setup.exe` — the installer

The installer is per-user (`currentUser`), so it needs no administrator rights.
Assets, icons and both windows are bundled into the executable; there is no
loose `dist` folder to ship alongside it.

## Using AURA

| Action | How |
|---|---|
| Talk to her | Click the character |
| Move her | Drag the character |
| Resize her | Settings → General → Character size |
| Send a message | Enter (Shift+Enter for a newline) |
| Show her your screen | Type a question, then **Look at screen** |
| Close the conversation | Click her again, or **—** in the panel header |
| Hide her | The **×** on hover, or the tray menu |
| Bring her back | Left-click the tray icon, or tray → **Show** |
| Reset a lost position | Tray → **Reset Position** |

The tray menu also has **Talk to AURA**, **Look at Screen**, a **Proactive Mode**
toggle, **Settings…**, **Restart** and **Quit**.

Clicks anywhere in the overlay window *except* on AURA herself pass straight
through to whatever is behind her, so she never blocks the desktop. This can be
turned off in Settings → General.

## Noticing what you're doing

AURA watches which application is in the foreground — via a Windows event hook,
so there is no polling loop — and builds a picture of your session locally:

- what you're in now and what you came from
- how long you've been in it, and how long today
- whether it's the first time in that app today
- whether you're focused or bouncing between windows

That picture does two things. It goes into her system prompt, so when you ask
her something she already knows the context. And it drives live reactions when
you switch apps, in one of three modes (Settings → Behavior):

| Mode | Behaviour |
|---|---|
| **Claude** (default) | She writes the line from the actual situation. On Haiku this is a fraction of a cent per reaction. Falls back to Local if the API is unavailable. |
| **Local** | Picks from her own writing, chosen by the same situation logic. Free and offline. |
| **Off** | She watches but stays quiet. |

Reactions are heavily rate-limited on purpose — a settle delay so app launches
don't trigger on the flicker, a cooldown of 6 minutes (Local) or 14 minutes
(Claude), silence while you're typing to her, and quiet hours respected. Most
switches produce nothing at all; the one exception is bouncing between windows,
which she'll always mention because you can't see it yourself.

Only executable names are read — never window titles. See
[Privacy controls](#privacy-controls).

## Settings reference

**General** — start with Windows, always on top, click-through, character size,
remember position/size, reset position.

**AI** — API key (save / test / remove), model, response length, effort, your
name, and free-form personality notes that are appended to her system prompt and
take precedence over her defaults.

**Behavior** — proactive messages on/off with minimum and maximum gap, quotes
on/off and interval, quiet hours, notification delivery, Windows notifications.

**Privacy** — active application awareness, screen understanding, conversation
storage. See below.

**Appearance** — character renderer, interface opacity, animation intensity,
greeting on start.

**Voice** — deliberately disabled. See [Architecture](#architecture).

Settings apply immediately and are written to
`%APPDATA%\com.aura.companion\settings.json`.

## Privacy controls

AURA's privacy posture is meant to be checkable, not just claimed:

- **The screen is captured only when you ask.** The "Look at screen" action and
  the tray's "Look at Screen" are the only two paths. There is no timer, no
  background capture and no code path that captures without emitting the
  on-screen indicator first.
- **Screenshots never touch the disk.** The capture is encoded to PNG in memory
  and handed straight to the request; the buffer is dropped when the request
  finishes. There is no temporary file to find or clean up.
- **Window titles are never read.** Active-app awareness reads the foreground
  process's *executable name* only (`code.exe`), because window titles routinely
  contain document names, URLs and message previews.
- **Nothing is recorded.** No microphone access, no keystroke capture, no
  filesystem scanning.
- **The model cannot act.** AURA has no tools. Claude's output is rendered as
  text and nothing else — it cannot run commands, touch files, or call back into
  the app.
- **The frontend cannot reach the network.** A strict CSP limits `connect-src`
  to Tauri's IPC channel, so even a compromised webview has no route out.
- **Conversation storage is optional** and holds the last 40 messages in the
  webview's local storage. Turning it off deletes them.

Each of the three data-touching features has its own switch, and turning one off
disables it at the Rust boundary, not just in the UI.

## Supplying a character asset

**What ships:** an original rigged vector character, drawn as layered SVG with
separate eyelids, irises, brows, lips, hair and torso. Every expression is a real
shape or transform change, not an image swap. It is a deliberate, finished art
style — but it is *stylised*, not photorealistic.

**If you want a photorealistic AURA**, the architecture is already there. Supply
alpha-channel WebM clips and switch renderer in Settings → Appearance:

1. Create `%APPDATA%\com.aura.companion\characters\`.
2. Add one clip per state, lowercase, `.webm`:

   ```
   idle.webm       listening.webm   thinking.webm
   talking.webm    happy.webm       curious.webm
   confused.webm   serious.webm     sleeping.webm
   ```

   Only `idle.webm` is required — every missing state falls back to it, so you
   can start with one clip and fill the rest in later.

3. Settings → Appearance → Character → **AURA — Video (your asset)**.

**Clip requirements**

| Property | Value |
|---|---|
| Container / codec | WebM, VP9 **with alpha** (`-c:v libvpx-vp9 -pix_fmt yuva420p`) |
| Aspect | Roughly 300 × 440 (portrait, character bottom-aligned) |
| Length | 3–8 s, seamlessly loopable |
| Frame rate | 24–30 fps |
| Background | Fully transparent — a matte background will show as a rectangle |

Example encode from a transparent PNG sequence:

```bash
ffmpeg -framerate 30 -i frame_%04d.png -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 1M idle.webm
```

**What I need from you if you want this:** the clips themselves. Generating
photorealistic human video is outside what I can produce here, so this is the one
part of the product that needs an asset from outside the codebase. Anything that
renders to transparent WebM works — a video model, a rendered 3D character, or
footage you own the rights to.

**Adding a different technology entirely** (Live2D, Rive, a glTF model on
three.js) means writing one file implementing `CharacterRenderer` and adding it
to the registry in `src/character/renderers/index.ts`. Nothing else changes —
the state machine, animation driver and app code never learn how she is drawn.

## Architecture

```
src/                        Frontend (React + TypeScript)
  character/                State machine, animation driver, renderers, artwork
  chat/                     Conversation state and the compact chat panel
  ai/                       System-prompt construction (local)
  scheduler/                Proactive scheduler and the local quote engine
  components/               Overlay, character stage, speech bubble
  settings/                 Settings window
  ipc/bridge.ts             The entire Rust command surface, typed
  voice/                    Provider interfaces (not implemented — see below)

src-tauri/src/              Backend (Rust)
  ai/                       Claude client: streaming SSE, retries, error taxonomy
  commands/                 Everything the webview is allowed to ask for
  desktop/                  Foreground-window hook, click-through watcher
  screen/                   GDI screen capture
  secrets.rs                Windows Credential Manager
  settings.rs               Persistence with forward-compatible defaults
  tray.rs, window.rs        Tray menu, overlay geometry
```

The privilege boundary is the IPC bridge. The API key, all network access,
screen capture and every Windows integration live in Rust. The webview renders
the character and the conversation and asks for capabilities by name.

**Animation runs outside React.** The driver writes CSS custom properties onto
one element inside a rAF loop; `character.css` maps them to transforms. A
character that is on screen permanently therefore costs a handful of style
writes per frame instead of a React render per frame. Discrete changes (state,
expression) go through React normally, because they happen a few times a minute.

**Voice is not implemented.** `src/voice/providers.ts` defines
`SpeechToTextProvider` and `TextToSpeechProvider` so speech can be added without
touching the character or conversation systems, and the Settings controls are
disabled rather than present-but-inert. Nothing in the app pretends to speak.

## Cost behaviour

Claude is called for exactly one thing: replying to you (including screen
analysis). Everything else is local.

| Feature | Cost |
|---|---|
| Animation, blinking, gaze, breathing | Free |
| Proactive lines, greetings, break nudges | Free — written locally |
| Random quotes | Free — local engine |
| Active-app awareness and reactions | Free — Windows event hook |
| Notifications, tray, settings, position | Free |
| Conversation and screen analysis | Claude API |

Additional restraint built in: history is trimmed to the last 12 turns so old
context isn't re-billed forever, the system prompt is kept short because it is
resent every turn, chat defaults to `effort: low`, and the model dropdown shows
per-model pricing at the point of choosing.

Default model is **Claude Haiku 4.5** ($1 / $5 per million tokens) — AURA talks
in one-liners, so the cheap, instant model is the right default. Sonnet 5 and
Opus 5 are one dropdown away in Settings, with pricing shown at the point of
choosing.

App-switch reactions default to **Claude-written** (each one is a tiny Haiku
request — a fraction of a cent) and automatically fall back to AURA's local
lines whenever the API is unavailable, so the feature works offline too.

## Troubleshooting

**AURA doesn't appear.** She may be hidden or positioned on a monitor that is no
longer attached. Left-click the tray icon, or tray → **Reset Position**.

**A grey or black rectangle instead of a transparent window.** The WebView2
Runtime is missing or very old — install the Evergreen runtime from Microsoft.

**Clicks aren't reaching the desktop behind her.** Settings → General →
*Click through empty space*. If it is on and still not working, some overlay
software (certain game bars and capture tools) forces the topmost window to
capture input; toggling *Always on top* off usually resolves it.

**"That key isn't being accepted."** Test it in Settings → AI. A key that works
elsewhere but fails here usually means the model selected in Settings isn't
enabled for that key's workspace.

**Replies pause before any text appears.** Expected on Opus 5 and Sonnet 5 —
they think before answering, and thinking text is not displayed. The character
shows THINKING during that window. Choose Haiku 4.5 in Settings for immediate
output, or drop effort to `low`.

**"Screen awareness is turned off in Settings."** Privacy → *Screen
understanding*.

**Nothing proactive ever happens.** Check Behavior → proactive enabled, the
gap bounds, and whether the current time falls inside quiet hours (23:00–08:00
by default).

**Build fails at the link step.** The MSVC linker is missing — install the
Visual Studio Build Tools **Desktop development with C++** workload.

**Settings didn't persist.** They live in
`%APPDATA%\com.aura.companion\settings.json`. If that file is corrupt AURA falls
back to defaults rather than failing to start; delete it to reset cleanly.
