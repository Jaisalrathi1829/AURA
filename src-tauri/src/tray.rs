//! System tray icon and menu.

use parking_lot::Mutex;
use std::sync::OnceLock;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::settings::Settings;
use crate::state::AppState;
use crate::window;

/// Kept so `refresh` can update the checkbox after a change made in Settings.
static PROACTIVE_ITEM: OnceLock<Mutex<Option<CheckMenuItem<tauri::Wry>>>> = OnceLock::new();

pub fn build(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let hide = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let talk = MenuItem::with_id(app, "talk", "Talk to AURA", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let look = MenuItem::with_id(app, "look", "Look at Screen", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let proactive = CheckMenuItem::with_id(
        app,
        "proactive",
        "Proactive Mode",
        true,
        settings.proactive_enabled,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let recenter = MenuItem::with_id(app, "recenter", "Reset Position", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let settings_item = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let restart = MenuItem::with_id(app, "restart", "Restart", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let sep = || PredefinedMenuItem::separator(app).map_err(|e| e.to_string());

    let menu = Menu::with_items(
        app,
        &[
            &show,
            &hide,
            &sep()?,
            &talk,
            &look,
            &proactive,
            &sep()?,
            &recenter,
            &settings_item,
            &sep()?,
            &restart,
            &quit,
        ],
    )
    .map_err(|e| e.to_string())?;

    PROACTIVE_ITEM
        .set(Mutex::new(Some(proactive)))
        .ok();

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| "no bundled window icon".to_string())?;

    TrayIconBuilder::with_id("aura-tray")
        .icon(icon)
        .tooltip("AURA")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(|tray, event| {
            // Left click toggles visibility; right click opens the menu.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_overlay(tray.app_handle());
            }
        })
        .build(app)
        .map_err(|e| format!("tray icon failed: {e}"))?;

    Ok(())
}

/// Re-sync menu state after settings change elsewhere.
pub fn refresh(_app: &AppHandle, settings: &Settings) {
    if let Some(slot) = PROACTIVE_ITEM.get() {
        if let Some(item) = slot.lock().as_ref() {
            let _ = item.set_checked(settings.proactive_enabled);
        }
    }
}

fn toggle_overlay(app: &AppHandle) {
    let Some(win) = app.get_webview_window("aura") else {
        return;
    };
    match win.is_visible() {
        Ok(true) => {
            let _ = win.hide();
        }
        _ => {
            let _ = win.show();
        }
    }
}

fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        "show" => {
            if let Some(win) = app.get_webview_window("aura") {
                let _ = win.show();
            }
        }
        "hide" => {
            if let Some(win) = app.get_webview_window("aura") {
                let _ = win.hide();
            }
        }
        "talk" => {
            if let Some(win) = app.get_webview_window("aura") {
                let _ = win.show();
            }
            let _ = app.emit("aura://tray-command", "talk");
        }
        "look" => {
            if let Some(win) = app.get_webview_window("aura") {
                let _ = win.show();
            }
            let _ = app.emit("aura://tray-command", "look");
        }
        "proactive" => {
            let Some(state) = app.try_state::<AppState>() else {
                return;
            };
            let updated = {
                let mut settings = state.settings.lock();
                settings.proactive_enabled = !settings.proactive_enabled;
                settings.clone()
            };
            let _ = crate::settings::save(app, &updated);
            refresh(app, &updated);
            let _ = app.emit("aura://settings-changed", &updated);
        }
        "recenter" => {
            let Some(state) = app.try_state::<AppState>() else {
                return;
            };
            {
                state.settings.lock().position = None;
            }
            let settings = state.settings_snapshot();
            let _ = window::apply_geometry(app, &settings);
            let _ = crate::settings::save(app, &settings);
            if let Some(win) = app.get_webview_window("aura") {
                let _ = win.show();
            }
        }
        "settings" => {
            let _ = window::open_settings_window(app);
        }
        "restart" => app.restart(),
        "quit" => app.exit(0),
        _ => {}
    }
}
