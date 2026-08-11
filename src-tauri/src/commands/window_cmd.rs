//! Overlay window geometry, visibility and click-through.

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::desktop::clickthrough::HitRect;
use crate::state::AppState;
use crate::window;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayLayout {
    pub panel_width: f64,
    pub character_width: f64,
    pub character_height: f64,
    pub window_width: f64,
    pub window_height: f64,
}

/// Layout the frontend needs to place the character and chat panel.
#[tauri::command]
pub fn overlay_layout(state: State<'_, AppState>) -> OverlayLayout {
    let scale = state.settings.lock().character_scale;
    let (w, h) = window::window_logical_size(scale);
    OverlayLayout {
        panel_width: window::PANEL_WIDTH,
        character_width: window::CHARACTER_WIDTH * scale,
        character_height: window::CHARACTER_HEIGHT * scale,
        window_width: w,
        window_height: h,
    }
}

/// Called once the overlay has painted, so the window can appear already
/// positioned instead of flashing in the wrong place.
#[tauri::command]
pub fn overlay_ready(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let settings = state.settings_snapshot();
    window::apply_geometry(&app, &settings)?;

    if let Some(win) = app.get_webview_window("aura") {
        let _ = win.set_always_on_top(settings.always_on_top);
        win.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Publish the character's hit rectangle (logical px inside the window).
#[tauri::command]
pub fn set_hit_rect(
    state: State<'_, AppState>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    state.click_through.set_hit_rect(HitRect {
        x,
        y,
        width,
        height,
    });
    Ok(())
}

/// The pointer entered or left the interactive region.
#[tauri::command]
pub fn set_pointer_over(
    app: AppHandle,
    state: State<'_, AppState>,
    over: bool,
) -> Result<(), String> {
    let Some(win) = app.get_webview_window("aura") else {
        return Ok(());
    };
    if over {
        state.click_through.deactivate(&win);
    } else {
        state.click_through.activate(&win);
    }
    Ok(())
}

/// Persist where the user dragged AURA to. The anchor is the window's
/// bottom-right corner so the character stays put when its size changes.
#[tauri::command]
pub fn persist_position(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let Some(win) = app.get_webview_window("aura") else {
        return Ok(());
    };
    let position = win.outer_position().map_err(|e| e.to_string())?;
    let size = win.outer_size().map_err(|e| e.to_string())?;

    {
        let mut settings = state.settings.lock();
        if !settings.remember_position {
            return Ok(());
        }
        settings.position = Some([
            position.x + size.width as i32,
            position.y + size.height as i32,
        ]);
    }
    crate::settings::save(&app, &state.settings_snapshot())
}

#[tauri::command]
pub fn set_overlay_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    let Some(win) = app.get_webview_window("aura") else {
        return Ok(());
    };
    if visible {
        win.show().map_err(|e| e.to_string())?;
    } else {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn start_drag(app: AppHandle) -> Result<(), String> {
    let Some(win) = app.get_webview_window("aura") else {
        return Ok(());
    };
    win.start_dragging().map_err(|e| e.to_string())
}

/// Open (or focus) the compact settings window, creating it lazily so an
/// always-running AURA does not carry a second webview it never shows.
#[tauri::command]
pub fn open_settings(app: AppHandle) -> Result<(), String> {
    window::open_settings_window(&app)
}

#[tauri::command]
pub fn close_settings(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("settings") {
        win.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Nudge the overlay fully back on-screen — the tray's escape hatch if AURA
/// ends up on a monitor that has since been unplugged.
#[tauri::command]
pub fn recenter_overlay(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    {
        let mut settings = state.settings.lock();
        settings.position = None;
    }
    let settings = state.settings_snapshot();
    window::apply_geometry(&app, &settings)?;
    crate::settings::save(&app, &settings)
}
