//! Explicit screen understanding.
//!
//! There is exactly one way a screenshot can be taken: the user invokes this
//! command. It is gated on a setting, it announces itself to the UI so the
//! capture is always visible, and the bytes never touch the filesystem.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use tauri::{AppHandle, Emitter, State};

use crate::screen::capture;
use crate::state::AppState;

#[tauri::command]
pub async fn capture_screen(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    if !state.settings_snapshot().screen_capture_enabled {
        return Err("Screen awareness is turned off in Settings.".into());
    }

    // Tell the UI first, so the capture indicator is on screen before the
    // shutter — the user should never learn about a capture after the fact.
    let _ = app.emit("aura://screen-capture", "start");

    let result = tauri::async_runtime::spawn_blocking(capture::capture_png)
        .await
        .map_err(|e| format!("capture task failed: {e}"))?;

    let _ = app.emit("aura://screen-capture", "end");

    let png = result?;
    Ok(STANDARD.encode(png))
}
