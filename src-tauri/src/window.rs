//! Overlay geometry.
//!
//! The window is a fixed layout: a chat panel column on the left and the
//! character on the right. The whole thing is transparent and click-through
//! except where the frontend says it is not, so allocating the panel's space up
//! front costs nothing visually and means the character never jumps sideways
//! when the conversation opens.
//!
//! Position is persisted as the window's **bottom-right corner**. Anchoring
//! there keeps the character in place when its size changes, and matches the
//! default bottom-right home.

use tauri::{AppHandle, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::settings::Settings;

pub const PANEL_WIDTH: f64 = 380.0;
pub const CHARACTER_WIDTH: f64 = 300.0;
pub const CHARACTER_HEIGHT: f64 = 440.0;
const MIN_WINDOW_HEIGHT: f64 = 560.0;
/// Headroom above the character for the speech bubble. Without it a long quote
/// would be clipped by the window edge at small character sizes.
const BUBBLE_HEADROOM: f64 = 150.0;
/// Gap between AURA and the screen edge in her default corner.
const EDGE_MARGIN: f64 = 24.0;

pub fn window_logical_size(scale: f64) -> (f64, f64) {
    let width = PANEL_WIDTH + CHARACTER_WIDTH * scale;
    let height = (CHARACTER_HEIGHT * scale + BUBBLE_HEADROOM).max(MIN_WINDOW_HEIGHT);
    (width, height)
}

/// Size and place the overlay from the current settings.
pub fn apply_geometry(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let Some(win) = app.get_webview_window("aura") else {
        return Ok(());
    };

    let (logical_w, logical_h) = window_logical_size(settings.character_scale);
    win.set_size(LogicalSize::new(logical_w, logical_h))
        .map_err(|e| format!("could not resize overlay: {e}"))?;

    let dpi = win.scale_factor().unwrap_or(1.0);
    let physical_w = (logical_w * dpi).round() as i32;
    let physical_h = (logical_h * dpi).round() as i32;

    let anchor = settings
        .position
        .filter(|_| settings.remember_position)
        .unwrap_or_else(|| default_anchor(&win, dpi));

    let mut x = anchor[0] - physical_w;
    let mut y = anchor[1] - physical_h;

    // A monitor that has been unplugged since the last run would otherwise
    // strand AURA off-screen.
    if !is_on_a_monitor(&win, x, y, physical_w, physical_h) {
        let fallback = default_anchor(&win, dpi);
        x = fallback[0] - physical_w;
        y = fallback[1] - physical_h;
    }

    win.set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|e| format!("could not position overlay: {e}"))?;
    Ok(())
}

fn default_anchor(win: &tauri::WebviewWindow, dpi: f64) -> [i32; 2] {
    let margin = (EDGE_MARGIN * dpi).round() as i32;
    // Bottom-right of the primary monitor, inset by the margin. A taskbar sits
    // in that corner on most setups, so bias upward a little more.
    match win.primary_monitor() {
        Ok(Some(monitor)) => {
            let pos = monitor.position();
            let size = monitor.size();
            [
                pos.x + size.width as i32 - margin,
                pos.y + size.height as i32 - margin * 3,
            ]
        }
        _ => [1920 - margin, 1080 - margin * 3],
    }
}

fn is_on_a_monitor(win: &tauri::WebviewWindow, x: i32, y: i32, w: i32, h: i32) -> bool {
    let Ok(monitors) = win.available_monitors() else {
        return true;
    };
    if monitors.is_empty() {
        return true;
    }
    monitors.iter().any(|m| {
        let pos = m.position();
        let size = m.size();
        let (mx, my) = (pos.x, pos.y);
        let (mw, mh) = (size.width as i32, size.height as i32);
        // Require a meaningful overlap, not just a shared edge pixel.
        let overlap_x = (x + w).min(mx + mw) - x.max(mx);
        let overlap_y = (y + h).min(my + mh) - y.max(my);
        overlap_x > 80 && overlap_y > 80
    })
}

/// Create the settings window on demand, or focus it if it already exists.
pub fn open_settings_window(app: &AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("settings") {
        let _ = existing.unminimize();
        existing.show().map_err(|e| e.to_string())?;
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
        .title("AURA — Settings")
        .inner_size(540.0, 680.0)
        .min_inner_size(460.0, 520.0)
        .resizable(true)
        .decorations(true)
        .transparent(false)
        .always_on_top(false)
        .skip_taskbar(false)
        .center()
        .visible(true)
        .build()
        .map_err(|e| format!("could not open settings: {e}"))?;
    Ok(())
}
