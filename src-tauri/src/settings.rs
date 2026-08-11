//! Persisted user settings.
//!
//! Every field carries a serde default so that a settings file written by an
//! older build still loads cleanly after new options are added. The API key is
//! deliberately *not* part of this struct — it lives in the Windows Credential
//! Manager (see `secrets.rs`) and never reaches the webview.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResponseLength {
    Brief,
    Normal,
    Detailed,
}

impl ResponseLength {
    /// Output ceiling, not a target — brevity comes from the system prompt.
    /// On thinking models `max_tokens` bounds thinking *and* reply text
    /// together, so these leave headroom rather than truncating mid-sentence.
    /// Billing is on tokens actually produced, so a generous cap costs nothing.
    pub fn max_tokens(self) -> u32 {
        match self {
            ResponseLength::Brief => 1500,
            ResponseLength::Normal => 3000,
            ResponseLength::Detailed => 8000,
        }
    }

    pub fn guidance(self) -> &'static str {
        match self {
            ResponseLength::Brief => "Answer in one or two sentences unless more is genuinely needed.",
            ResponseLength::Normal => "Keep answers short — a few sentences. Expand only when the question earns it.",
            ResponseLength::Detailed => "You may go into detail when the question warrants it, but never pad.",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    // ---- General ----
    pub start_with_windows: bool,
    pub always_on_top: bool,
    /// Multiplier applied to the character's base size.
    pub character_scale: f64,
    pub remember_position: bool,
    pub remember_size: bool,
    pub position: Option<[i32; 2]>,
    pub size: Option<[u32; 2]>,
    /// Let clicks fall through to the desktop everywhere except the character.
    pub click_through_empty: bool,

    // ---- AI ----
    pub model: String,
    pub response_length: ResponseLength,
    /// `low` | `medium` | `high` — ignored for models that don't support it.
    pub effort: String,
    /// Free-form personality addendum from the user.
    pub persona_note: String,
    pub user_name: String,

    // ---- Behavior ----
    pub proactive_enabled: bool,
    pub proactive_min_minutes: u32,
    pub proactive_max_minutes: u32,
    pub quotes_enabled: bool,
    pub quote_interval_minutes: u32,
    pub quiet_hours_enabled: bool,
    pub quiet_hours_start: u8,
    pub quiet_hours_end: u8,
    pub notifications_enabled: bool,
    /// Deliver proactive lines as Windows toasts instead of speech bubbles.
    pub proactive_as_notification: bool,

    /// `off` | `local` | `claude` — how AURA reacts to app switches.
    /// `local` is free; `claude` writes each line and therefore costs credit.
    pub app_reaction_mode: String,

    // ---- Privacy ----
    pub app_awareness_enabled: bool,
    pub screen_capture_enabled: bool,
    pub store_conversation: bool,

    // ---- Appearance ----
    /// `vector` (built-in rig) or `video` (user-supplied transparent WebM set).
    pub renderer: String,
    pub ui_opacity: f64,
    pub animation_intensity: f64,
    pub greeting_on_start: bool,

    // ---- Voice (interfaces exist; no provider ships in v1) ----
    pub voice_enabled: bool,
    pub tts_provider: String,
    pub stt_provider: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            start_with_windows: false,
            always_on_top: true,
            character_scale: 1.0,
            remember_position: true,
            remember_size: true,
            position: None,
            size: None,
            click_through_empty: true,

            // Haiku by default: AURA's replies are short and frequent, and a
            // companion that costs real money to say "morning" is one you turn
            // off. Sonnet 5 and Opus 5 are one dropdown away in Settings.
            model: "claude-haiku-4-5".into(),
            response_length: ResponseLength::Normal,
            effort: "low".into(),
            persona_note: String::new(),
            user_name: String::new(),

            proactive_enabled: true,
            proactive_min_minutes: 45,
            proactive_max_minutes: 120,
            quotes_enabled: true,
            quote_interval_minutes: 90,
            quiet_hours_enabled: true,
            quiet_hours_start: 23,
            quiet_hours_end: 8,
            notifications_enabled: true,
            proactive_as_notification: false,
            // Claude-written reactions are the point of the feature; on Haiku a
            // reaction costs a fraction of a cent, and it falls back to the
            // local lines whenever the API is unavailable.
            app_reaction_mode: "claude".into(),

            app_awareness_enabled: true,
            screen_capture_enabled: true,
            store_conversation: true,

            renderer: "vector".into(),
            ui_opacity: 0.92,
            animation_intensity: 1.0,
            greeting_on_start: true,

            voice_enabled: false,
            tts_provider: "none".into(),
            stt_provider: "none".into(),
        }
    }
}

impl Settings {
    /// Clamp anything a hand-edited config file could have put out of range, so
    /// a bad value degrades to a sane one instead of breaking the overlay.
    pub fn sanitize(&mut self) {
        self.character_scale = self.character_scale.clamp(0.5, 2.0);
        self.ui_opacity = self.ui_opacity.clamp(0.4, 1.0);
        self.animation_intensity = self.animation_intensity.clamp(0.0, 1.0);

        if !matches!(self.effort.as_str(), "low" | "medium" | "high") {
            self.effort = "low".into();
        }
        if !crate::ai::is_supported_model(&self.model) {
            self.model = "claude-haiku-4-5".into();
        }
        if !matches!(self.renderer.as_str(), "vector" | "video") {
            self.renderer = "vector".into();
        }
        if !matches!(self.app_reaction_mode.as_str(), "off" | "local" | "claude") {
            self.app_reaction_mode = "local".into();
        }
        // Reacting to apps is meaningless without the awareness that feeds it.
        if !self.app_awareness_enabled {
            self.app_reaction_mode = "off".into();
        }

        self.proactive_min_minutes = self.proactive_min_minutes.clamp(5, 720);
        self.proactive_max_minutes = self
            .proactive_max_minutes
            .clamp(self.proactive_min_minutes.max(5), 1440);
        self.quote_interval_minutes = self.quote_interval_minutes.clamp(10, 1440);
        self.quiet_hours_start = self.quiet_hours_start.min(23);
        self.quiet_hours_end = self.quiet_hours_end.min(23);
    }
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no config dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    Ok(dir.join("settings.json"))
}

/// Load settings from disk. A missing or corrupt file yields defaults rather
/// than an error — AURA must always be able to start.
pub fn load(app: &AppHandle) -> Settings {
    let mut settings = settings_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|raw| match serde_json::from_str::<Settings>(&raw) {
            Ok(s) => Some(s),
            Err(e) => {
                eprintln!("[aura] settings.json unreadable ({e}); using defaults");
                None
            }
        })
        .unwrap_or_default();
    settings.sanitize();
    settings
}

pub fn save(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    let json =
        serde_json::to_string_pretty(settings).map_err(|e| format!("serialize failed: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("write {} failed: {e}", path.display()))
}
