//! Explicit screen understanding.
//!
//! There is exactly one way a screenshot can be taken: the user invokes this
//! command. It is gated on a setting, it announces itself to the UI so the
//! capture is always visible, and the bytes never touch the filesystem.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::screen::{capture, ocr};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenCapture {
    /// Downscaled PNG, for engines that can see images.
    pub png_base64: String,
    /// Text read from the screen on this machine, for engines that can't.
    /// Null if OCR is unavailable (e.g. no OCR language pack installed).
    pub text: Option<String>,
}

#[tauri::command]
pub async fn capture_screen(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ScreenCapture, String> {
    if !state.settings_snapshot().screen_capture_enabled {
        return Err("Screen awareness is turned off in Settings.".into());
    }

    // Tell the UI first, so the capture indicator is on screen before the
    // shutter — the user should never learn about a capture after the fact.
    let _ = app.emit("aura://screen-capture", "start");

    // AURA sits on top of everything, so without this she would mostly be
    // reading her own chat panel back to herself.
    let exclusion = CaptureExclusion::begin(&app);

    let result = tauri::async_runtime::spawn_blocking(|| -> Result<ScreenCapture, String> {
        let frame = capture::capture_frame()?;
        let png = frame.to_png()?;
        let text = match ocr::recognize(&frame) {
            Ok(t) if !t.trim().is_empty() => Some(t),
            Ok(_) => None,
            Err(e) => {
                eprintln!("[aura] OCR unavailable: {e}");
                None
            }
        };
        Ok(ScreenCapture {
            png_base64: STANDARD.encode(png),
            text,
        })
    })
    .await
    .map_err(|e| format!("capture task failed: {e}"));

    drop(exclusion);
    let _ = app.emit("aura://screen-capture", "end");

    result?
}

/// Hides AURA's own windows from screen capture for as long as it lives.
/// They stay visible on screen throughout — only captures skip them.
struct CaptureExclusion {
    /// Window handles as integers: `HWND` wraps a raw pointer, which would make
    /// the async command's future non-`Send`.
    #[cfg(windows)]
    windows: Vec<isize>,
}

impl CaptureExclusion {
    fn begin(app: &AppHandle) -> Self {
        #[cfg(windows)]
        {
            use windows::Win32::Foundation::HWND;
            use windows::Win32::UI::WindowsAndMessaging::{
                SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE,
            };

            let mut windows = Vec::new();
            for label in ["aura", "settings"] {
                let Some(win) = app.get_webview_window(label) else {
                    continue;
                };
                let Ok(raw) = win.hwnd() else { continue };
                let handle = raw.0 as isize;
                let hwnd = HWND(handle as _);
                if unsafe { SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE) }.is_ok() {
                    windows.push(handle);
                }
            }
            // The compositor applies the affinity on its next frame.
            std::thread::sleep(std::time::Duration::from_millis(60));
            Self { windows }
        }
        #[cfg(not(windows))]
        {
            let _ = app;
            Self {}
        }
    }
}

impl Drop for CaptureExclusion {
    fn drop(&mut self) {
        #[cfg(windows)]
        {
            use windows::Win32::Foundation::HWND;
            use windows::Win32::UI::WindowsAndMessaging::{SetWindowDisplayAffinity, WDA_NONE};
            for handle in &self.windows {
                let _ = unsafe { SetWindowDisplayAffinity(HWND(*handle as _), WDA_NONE) };
            }
        }
    }
}
