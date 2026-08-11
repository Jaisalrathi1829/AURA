//! AURA — a persistent AI desktop companion.
//!
//! Everything privileged lives on this side of the bridge: the API key, the
//! network calls that use it, screen capture, and the Windows integrations.
//! The webview renders the character and the conversation and asks for those
//! capabilities by name — it never holds a secret and cannot reach the network
//! on its own (see the CSP in `tauri.conf.json`).

pub mod ai;
pub mod commands;
pub mod desktop;
pub mod screen;
pub mod secrets;
pub mod settings;
pub mod state;
pub mod tray;
pub mod window;

use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

use crate::desktop::clickthrough;
use crate::desktop::foreground;
use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None::<Vec<&str>>,
        ))
        .invoke_handler(tauri::generate_handler![
            // settings + credentials
            commands::settings_cmd::get_settings,
            commands::settings_cmd::save_settings,
            commands::settings_cmd::list_models,
            commands::settings_cmd::has_api_key,
            commands::settings_cmd::set_api_key,
            commands::settings_cmd::clear_api_key,
            commands::settings_cmd::test_api_key,
            commands::settings_cmd::autostart_is_enabled,
            // window
            commands::window_cmd::overlay_layout,
            commands::window_cmd::overlay_ready,
            commands::window_cmd::set_hit_rect,
            commands::window_cmd::set_pointer_over,
            commands::window_cmd::persist_position,
            commands::window_cmd::set_overlay_visible,
            commands::window_cmd::start_drag,
            commands::window_cmd::open_settings,
            commands::window_cmd::close_settings,
            commands::window_cmd::recenter_overlay,
            // ai
            commands::ai_cmd::send_message,
            commands::ai_cmd::cancel_message,
            // screen
            commands::screen_cmd::capture_screen,
            // system
            commands::system_cmd::show_notification,
            commands::system_cmd::trace,
            commands::system_cmd::get_active_app,
            commands::system_cmd::restart_app,
            commands::system_cmd::quit_app,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let loaded = settings::load(&handle);

            let state = AppState::new(loaded.clone());
            let click_through = state.click_through.clone();
            app.manage(state);

            if let Some(win) = app.get_webview_window("aura") {
                let _ = win.set_always_on_top(loaded.always_on_top);
                click_through.set_enabled(&win, loaded.click_through_empty);
            }

            clickthrough::spawn_watcher(handle.clone(), click_through);

            foreground::set_enabled(loaded.app_awareness_enabled);
            foreground::start(handle.clone());

            if let Err(e) = tray::build(&handle, &loaded) {
                // A missing tray is degraded, not fatal — the overlay still runs.
                eprintln!("[aura] tray unavailable: {e}");
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the settings window must not take the app down with it,
            // and the overlay's close button hides rather than exits.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "aura" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to start AURA")
        .run(|_app, event| {
            // Closing every window is normal for a tray app; keep running.
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
