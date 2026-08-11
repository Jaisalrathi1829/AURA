//! Settings and credential commands.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt;

use crate::ai::{ModelInfo, MODELS};
use crate::desktop::foreground;
use crate::secrets;
use crate::settings::Settings;
use crate::state::AppState;
use crate::window;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOption {
    pub id: &'static str,
    pub label: &'static str,
    pub input_price: f64,
    pub output_price: f64,
    pub supports_effort: bool,
    pub thinks: bool,
    pub note: &'static str,
}

impl From<&'static ModelInfo> for ModelOption {
    fn from(m: &'static ModelInfo) -> Self {
        Self {
            id: m.id,
            label: m.label,
            input_price: m.input_price,
            output_price: m.output_price,
            supports_effort: m.supports_effort,
            thinks: m.thinks,
            note: m.note,
        }
    }
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings_snapshot()
}

#[tauri::command]
pub fn list_models() -> Vec<ModelOption> {
    MODELS.iter().map(ModelOption::from).collect()
}

/// Replace the whole settings object, then apply every side effect it implies.
/// Doing this in one place means the overlay, tray, autostart and OS hooks can
/// never drift out of sync with what the settings window shows.
#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    mut incoming: Settings,
) -> Result<Settings, String> {
    incoming.sanitize();

    let previous = state.settings_snapshot();
    // Position is owned by dragging, not by the settings form.
    incoming.position = previous.position;

    {
        *state.settings.lock() = incoming.clone();
    }
    crate::settings::save(&app, &incoming)?;

    if let Some(win) = app.get_webview_window("aura") {
        let _ = win.set_always_on_top(incoming.always_on_top);
        state
            .click_through
            .set_enabled(&win, incoming.click_through_empty);
    }

    if (incoming.character_scale - previous.character_scale).abs() > f64::EPSILON {
        window::apply_geometry(&app, &incoming)?;
    }

    foreground::set_enabled(incoming.app_awareness_enabled);

    if incoming.start_with_windows != previous.start_with_windows {
        let manager = app.autolaunch();
        let result = if incoming.start_with_windows {
            manager.enable()
        } else {
            manager.disable()
        };
        if let Err(e) = result {
            eprintln!("[aura] autostart change failed: {e}");
        }
    }

    // Both windows listen for this so the overlay reacts the instant a setting
    // changes, without polling.
    let _ = app.emit("aura://settings-changed", &incoming);
    crate::tray::refresh(&app, &incoming);

    Ok(incoming)
}

#[tauri::command]
pub fn has_api_key() -> bool {
    secrets::has_api_key()
}

#[tauri::command]
pub fn set_api_key(app: AppHandle, key: String) -> Result<bool, String> {
    secrets::set_api_key(&key)?;
    let present = secrets::has_api_key();
    let _ = app.emit("aura://api-key-changed", present);
    Ok(present)
}

#[tauri::command]
pub fn clear_api_key(app: AppHandle) -> Result<(), String> {
    secrets::clear_api_key()?;
    let _ = app.emit("aura://api-key-changed", false);
    Ok(())
}

/// Verify the stored key with the cheapest possible call.
#[tauri::command]
pub async fn test_api_key(state: State<'_, AppState>) -> Result<String, String> {
    let model = state.settings_snapshot().model;
    crate::ai::claude::verify_key(&model).await
}

#[tauri::command]
pub fn autostart_is_enabled(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}
