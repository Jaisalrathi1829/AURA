//! Notifications, process lifecycle and desktop awareness.

use tauri::{AppHandle, State};
use tauri_plugin_notification::NotificationExt;

use crate::desktop::foreground::{self, ActiveApp};
use crate::state::AppState;

#[tauri::command]
pub fn show_notification(
    app: AppHandle,
    state: State<'_, AppState>,
    title: String,
    body: String,
) -> Result<(), String> {
    if !state.settings_snapshot().notifications_enabled {
        return Ok(());
    }
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| format!("notification failed: {e}"))
}

#[tauri::command]
pub fn get_active_app(state: State<'_, AppState>) -> Option<ActiveApp> {
    if !state.settings_snapshot().app_awareness_enabled {
        return None;
    }
    foreground::current()
}

/// Development-only trace from the webview to the terminal running `tauri dev`.
/// Compiled to a no-op in release builds, so a packaged AURA cannot be made to
/// log anything by the page.
#[tauri::command]
pub fn trace(message: String) {
    #[cfg(debug_assertions)]
    eprintln!("[aura:ui] {message}");
    #[cfg(not(debug_assertions))]
    let _ = message;
}

#[tauri::command]
pub fn restart_app(app: AppHandle) {
    app.restart();
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}
