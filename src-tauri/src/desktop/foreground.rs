//! Active-application awareness.
//!
//! Driven by `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)` on a dedicated thread
//! with its own message pump — the OS tells us when focus moves, so there is no
//! polling loop burning CPU in the background.
//!
//! Privacy note: only the executable name is captured. Window titles routinely
//! contain document names, URLs and message previews, so they are never read.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

static APP: OnceLock<AppHandle> = OnceLock::new();
static ENABLED: AtomicBool = AtomicBool::new(true);
static LAST_EXE: Mutex<Option<String>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveApp {
    /// Lowercased executable name, e.g. `code.exe`.
    pub exe: String,
    /// Human label if we recognise it, otherwise the exe stem.
    pub label: String,
    /// Coarse bucket the character can react to without asking Claude.
    pub category: &'static str,
}

pub fn set_enabled(enabled: bool) {
    ENABLED.store(enabled, Ordering::Relaxed);
    if !enabled {
        *LAST_EXE.lock() = None;
    }
}

pub fn is_enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

/// Map an executable to a friendly label and category.
///
/// Entirely local. Recognising what the user just opened is exactly the kind of
/// thing that must never cost an API call, so the table is deliberately broad —
/// the more apps named here, the more specific AURA can be for free.
fn describe(exe_lower: &str) -> (String, &'static str) {
    let (label, category) = match exe_lower {
        // ---- code editors and IDEs ----
        "code.exe" | "code - insiders.exe" => ("VS Code", "editor"),
        "cursor.exe" => ("Cursor", "editor"),
        "windsurf.exe" | "zed.exe" | "void.exe" => ("your editor", "editor"),
        "devenv.exe" => ("Visual Studio", "editor"),
        "idea64.exe" => ("IntelliJ", "editor"),
        "pycharm64.exe" => ("PyCharm", "editor"),
        "webstorm64.exe" => ("WebStorm", "editor"),
        "rustrover64.exe" => ("RustRover", "editor"),
        "clion64.exe" | "goland64.exe" | "rider64.exe" | "datagrip64.exe" => {
            ("a JetBrains IDE", "editor")
        }
        "sublime_text.exe" | "notepad++.exe" | "notepad.exe" | "gvim.exe" => {
            ("a text editor", "editor")
        }
        "androidstudio64.exe" | "studio64.exe" => ("Android Studio", "editor"),
        "unity.exe" | "unrealeditor.exe" | "godot.exe" | "godot_v4.exe" => {
            ("a game engine", "editor")
        }

        // ---- terminals and shells ----
        "windowsterminal.exe" | "wt.exe" | "openconsole.exe" => ("Windows Terminal", "terminal"),
        "powershell.exe" | "pwsh.exe" | "cmd.exe" | "conhost.exe" | "alacritty.exe"
        | "wezterm-gui.exe" | "hyper.exe" | "tabby.exe" | "mintty.exe" | "ubuntu.exe" => {
            ("the terminal", "terminal")
        }

        // ---- browsers ----
        "chrome.exe" => ("Chrome", "browser"),
        "msedge.exe" => ("Edge", "browser"),
        "firefox.exe" | "zen.exe" | "librewolf.exe" => ("Firefox", "browser"),
        "brave.exe" | "opera.exe" | "operagx.exe" | "vivaldi.exe" | "arc.exe" => {
            ("your browser", "browser")
        }

        // ---- files and system ----
        "explorer.exe" => ("File Explorer", "files"),
        "winrar.exe" | "7zfm.exe" | "peazip.exe" => ("an archive", "files"),
        "taskmgr.exe" | "perfmon.exe" | "resmon.exe" => ("Task Manager", "system"),
        "regedit.exe" | "mmc.exe" | "systemsettings.exe" | "control.exe" => {
            ("Windows settings", "system")
        }

        // ---- data, dev tooling ----
        "docker desktop.exe" => ("Docker", "devtools"),
        "postman.exe" | "insomnia.exe" | "bruno.exe" => ("an API client", "devtools"),
        "dbeaver.exe" | "ssms.exe" | "pgadmin4.exe" | "mongodbcompass.exe"
        | "tableplus.exe" => ("a database client", "devtools"),
        "github desktop.exe" | "githubdesktop.exe" | "sourcetree.exe" | "fork.exe"
        | "gitkraken.exe" | "tortoisegitproc.exe" => ("a Git client", "devtools"),
        "wireshark.exe" | "fiddler everywhere.exe" | "postgres.exe" => {
            ("dev tooling", "devtools")
        }

        // ---- media ----
        "spotify.exe" => ("Spotify", "media"),
        "vlc.exe" | "mpc-hc64.exe" | "mpv.exe" | "potplayermini64.exe" => {
            ("a video player", "media")
        }
        "musicbee.exe" | "foobar2000.exe" | "itunes.exe" | "applemusic.exe" => {
            ("music", "media")
        }
        "obs64.exe" | "obs32.exe" => ("OBS", "media"),
        "premiere.exe" | "afterfx.exe" | "resolve.exe" | "vegas200.exe" => {
            ("video editing", "design")
        }
        "audacity.exe" | "ableton live 12 suite.exe" | "flstudio64.exe" => {
            ("audio work", "design")
        }

        // ---- communication ----
        "discord.exe" | "discordptb.exe" => ("Discord", "social"),
        "slack.exe" => ("Slack", "social"),
        "teams.exe" | "ms-teams.exe" => ("Teams", "social"),
        "telegram.exe" | "whatsapp.exe" | "signal.exe" | "messenger.exe" => {
            ("a messenger", "social")
        }
        "zoom.exe" | "cpthost.exe" | "webexmta.exe" => ("a video call", "meeting"),
        "outlook.exe" | "olk.exe" | "thunderbird.exe" | "mailspring.exe" => ("email", "email"),

        // ---- games ----
        "steam.exe" | "steamwebhelper.exe" => ("Steam", "games"),
        "epicgameslauncher.exe" | "battle.net.exe" | "riotclientux.exe"
        | "goggalaxy.exe" | "ubisoftconnect.exe" | "eadesktop.exe" => {
            ("a game launcher", "games")
        }
        "minecraft.windows.exe" | "javaw.exe" | "cs2.exe" | "valorant-win64-shipping.exe"
        | "leagueoflegends.exe" | "factorio.exe" | "dota2.exe" => ("a game", "games"),

        // ---- design ----
        "figma.exe" | "figma_agent.exe" => ("Figma", "design"),
        "photoshop.exe" | "illustrator.exe" | "indesign.exe" | "lightroom.exe" => {
            ("Adobe", "design")
        }
        "blender.exe" | "3dsmax.exe" | "maya.exe" | "cinema 4d.exe" => ("3D work", "design"),
        "affinityphoto.exe" | "affinitydesigner.exe" | "krita.exe" | "gimp-2.10.exe"
        | "inkscape.exe" | "canva.exe" | "mspaint.exe" => ("design work", "design"),

        // ---- documents and notes ----
        "excel.exe" => ("Excel", "documents"),
        "winword.exe" => ("Word", "documents"),
        "powerpnt.exe" => ("PowerPoint", "documents"),
        "onenote.exe" | "obsidian.exe" | "notion.exe" | "logseq.exe" | "joplin.exe"
        | "evernote.exe" => ("your notes", "notes"),
        "acrord32.exe" | "acrobat.exe" | "sumatrapdf.exe" | "foxitpdfreader.exe" => {
            ("a PDF", "documents")
        }

        // ---- reference and learning ----
        "calibre.exe" | "sioyek.exe" | "zotero.exe" | "mendeley.exe" => {
            ("reading", "reading")
        }

        _ => ("", "other"),
    };

    if label.is_empty() {
        let stem = exe_lower.trim_end_matches(".exe");
        (stem.to_string(), category)
    } else {
        (label.to_string(), category)
    }
}

#[cfg(windows)]
mod imp {
    use super::*;
    use windows::Win32::Foundation::{CloseHandle, HWND, MAX_PATH};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, GetForegroundWindow, GetMessageW, GetWindowThreadProcessId,
        TranslateMessage, CHILDID_SELF, EVENT_SYSTEM_FOREGROUND, MSG, OBJID_WINDOW,
        WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
    };

    fn exe_name_for(hwnd: HWND) -> Option<String> {
        if hwnd.0.is_null() {
            return None;
        }
        let mut pid: u32 = 0;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        if pid == 0 {
            return None;
        }

        let handle =
            unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;

        let mut buf = [0u16; MAX_PATH as usize];
        let mut len = buf.len() as u32;
        let result = unsafe {
            QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_FORMAT(0),
                windows::core::PWSTR(buf.as_mut_ptr()),
                &mut len,
            )
        };
        unsafe {
            let _ = CloseHandle(handle);
        }
        result.ok()?;

        let full = String::from_utf16_lossy(&buf[..len as usize]);
        full.rsplit(['\\', '/'])
            .next()
            .map(|s| s.to_ascii_lowercase())
            .filter(|s| !s.is_empty())
    }

    fn report(exe: String) {
        // Debounce: focus events fire repeatedly for the same app.
        {
            let mut last = LAST_EXE.lock();
            if last.as_deref() == Some(exe.as_str()) {
                return;
            }
            *last = Some(exe.clone());
        }

        // AURA's own overlay taking focus is not an app change worth reacting to.
        if exe == "aura.exe" {
            return;
        }

        let (label, category) = describe(&exe);
        #[cfg(debug_assertions)]
        eprintln!("[aura] foreground -> {exe} ({category})");

        if let Some(app) = APP.get() {
            let _ = app.emit(
                "aura://active-app",
                ActiveApp {
                    exe,
                    label,
                    category,
                },
            );
        }
    }

    unsafe extern "system" fn win_event_proc(
        _hook: HWINEVENTHOOK,
        event: u32,
        hwnd: HWND,
        id_object: i32,
        id_child: i32,
        _thread: u32,
        _time: u32,
    ) {
        if event != EVENT_SYSTEM_FOREGROUND
            || id_object != OBJID_WINDOW.0
            || id_child != CHILDID_SELF as i32
        {
            return;
        }
        if !is_enabled() {
            return;
        }
        if let Some(exe) = exe_name_for(hwnd) {
            report(exe);
        }
    }

    pub fn start(app: AppHandle) {
        let _ = APP.set(app);

        std::thread::Builder::new()
            .name("aura-foreground-hook".into())
            .spawn(|| unsafe {
                let hook = SetWinEventHook(
                    EVENT_SYSTEM_FOREGROUND,
                    EVENT_SYSTEM_FOREGROUND,
                    None,
                    Some(win_event_proc),
                    0,
                    0,
                    WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
                );
                if hook.is_invalid() {
                    eprintln!("[aura] could not install foreground hook");
                    return;
                }

                // A WinEvent hook only delivers callbacks to a thread that pumps
                // messages, so this thread parks in GetMessageW for the app's life.
                let mut msg = MSG::default();
                while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            })
            .ok();
    }

    pub fn current() -> Option<ActiveApp> {
        let hwnd = unsafe { GetForegroundWindow() };
        let exe = exe_name_for(hwnd)?;
        let (label, category) = describe(&exe);
        Some(ActiveApp {
            exe,
            label,
            category,
        })
    }
}

#[cfg(not(windows))]
mod imp {
    use super::*;
    pub fn start(app: AppHandle) {
        let _ = APP.set(app);
    }
    pub fn current() -> Option<ActiveApp> {
        None
    }
}

pub use imp::{current, start};

#[cfg(test)]
mod tests {
    use super::describe;

    #[test]
    fn known_apps_get_friendly_labels() {
        assert_eq!(describe("code.exe"), ("VS Code".to_string(), "editor"));
        assert_eq!(describe("chrome.exe").1, "browser");
    }

    #[test]
    fn unknown_apps_fall_back_to_the_exe_stem() {
        assert_eq!(describe("foobar.exe"), ("foobar".to_string(), "other"));
    }
}
