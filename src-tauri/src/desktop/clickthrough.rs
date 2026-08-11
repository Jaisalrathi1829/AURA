//! Click-through for the transparent parts of the overlay.
//!
//! The overlay window is a rectangle; the character inside it is not. Without
//! help, the transparent corners would still swallow clicks meant for the
//! desktop, which breaks the illusion that AURA is *on* the desktop.
//!
//! The frontend publishes the character's hit rectangle. When the pointer
//! leaves it, the window starts ignoring cursor events — at which point the
//! webview stops receiving mouse moves, so a short-lived watcher polls
//! `GetCursorPos` (a cheap syscall) to notice the pointer coming back. The
//! watcher parks on a `Notify` whenever pass-through is off, so an idle AURA
//! costs zero wakeups.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use tauri::{AppHandle, Manager, WebviewWindow};
use tokio::sync::Notify;

const POLL_INTERVAL: Duration = Duration::from_millis(120);
/// Grow the hit rect slightly when testing re-entry so the boundary does not
/// flicker as the pointer skims the edge.
const REENTRY_MARGIN: f64 = 6.0;

#[derive(Debug, Clone, Copy, Default)]
pub struct HitRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub struct ClickThrough {
    /// User setting: is pass-through wanted at all?
    enabled: AtomicBool,
    /// Is the window currently ignoring cursor events?
    active: AtomicBool,
    rect: Mutex<HitRect>,
    wake: Notify,
}

impl ClickThrough {
    pub fn new() -> Self {
        Self {
            enabled: AtomicBool::new(true),
            active: AtomicBool::new(false),
            rect: Mutex::new(HitRect::default()),
            wake: Notify::new(),
        }
    }

    pub fn set_hit_rect(&self, rect: HitRect) {
        *self.rect.lock() = rect;
    }

    pub fn is_active(&self) -> bool {
        self.active.load(Ordering::Relaxed)
    }

    /// Turn the feature on or off. Disabling immediately restores a normal,
    /// clickable window.
    pub fn set_enabled(&self, window: &WebviewWindow, enabled: bool) {
        self.enabled.store(enabled, Ordering::Relaxed);
        if !enabled {
            self.deactivate(window);
        }
    }

    /// Called by the frontend when the pointer leaves the character.
    pub fn activate(&self, window: &WebviewWindow) {
        if !self.enabled.load(Ordering::Relaxed) || self.active.load(Ordering::Relaxed) {
            return;
        }
        if window.set_ignore_cursor_events(true).is_ok() {
            self.active.store(true, Ordering::Relaxed);
            self.wake.notify_one();
        }
    }

    /// Restore normal hit-testing, either because the pointer came back or
    /// because something needs the window interactive (chat opening, etc.).
    pub fn deactivate(&self, window: &WebviewWindow) {
        if !self.active.swap(false, Ordering::Relaxed) {
            return;
        }
        let _ = window.set_ignore_cursor_events(false);
    }
}

impl Default for ClickThrough {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(windows)]
fn cursor_position() -> Option<(i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

    let mut point = POINT::default();
    unsafe { GetCursorPos(&mut point) }.ok()?;
    Some((point.x, point.y))
}

#[cfg(not(windows))]
fn cursor_position() -> Option<(i32, i32)> {
    None
}

/// Spawn the watcher. It sleeps on `Notify` while pass-through is inactive.
pub fn spawn_watcher(app: AppHandle, state: Arc<ClickThrough>) {
    tauri::async_runtime::spawn(async move {
        loop {
            if !state.active.load(Ordering::Relaxed) {
                state.wake.notified().await;
                continue;
            }

            tokio::time::sleep(POLL_INTERVAL).await;

            let Some(window) = app.get_webview_window("aura") else {
                continue;
            };
            if !state.active.load(Ordering::Relaxed) {
                continue;
            }

            let Some((cx, cy)) = cursor_position() else {
                continue;
            };
            let (Ok(origin), Ok(scale)) = (window.outer_position(), window.scale_factor()) else {
                continue;
            };

            let rect = *state.rect.lock();
            if rect.width <= 0.0 || rect.height <= 0.0 {
                continue;
            }

            // The hit rect is logical pixels inside the window; the cursor is
            // physical pixels on the virtual desktop.
            let left = origin.x as f64 + (rect.x - REENTRY_MARGIN) * scale;
            let top = origin.y as f64 + (rect.y - REENTRY_MARGIN) * scale;
            let right = origin.x as f64 + (rect.x + rect.width + REENTRY_MARGIN) * scale;
            let bottom = origin.y as f64 + (rect.y + rect.height + REENTRY_MARGIN) * scale;

            let inside = (cx as f64) >= left
                && (cx as f64) <= right
                && (cy as f64) >= top
                && (cy as f64) <= bottom;

            if inside {
                state.deactivate(&window);
            }
        }
    });
}
