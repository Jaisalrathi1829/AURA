//! Claude conversation commands.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, Manager, State};

use crate::ai::claude::{ChatConfig, ChatRequest};
use crate::state::AppState;

/// Start a streamed exchange. Returns immediately; text arrives as
/// `aura://ai-delta` events keyed by `requestId`.
#[tauri::command]
pub fn send_message(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ChatRequest,
) -> Result<(), String> {
    let settings = state.settings_snapshot();
    let config = ChatConfig {
        model: settings.model.clone(),
        effort: settings.effort.clone(),
        max_tokens: settings.response_length.max_tokens(),
    };

    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut in_flight = state.in_flight.lock();
        // One conversation at a time — a second send supersedes the first.
        for flag in in_flight.values() {
            flag.store(true, Ordering::Relaxed);
        }
        in_flight.clear();
        in_flight.insert(request.request_id.clone(), cancel.clone());
    }

    let request_id = request.request_id.clone();
    let app_for_task = app.clone();
    tauri::async_runtime::spawn(async move {
        crate::ai::stream_chat(app_for_task.clone(), request, config, cancel).await;
        if let Some(state) = app_for_task.try_state::<AppState>() {
            state.in_flight.lock().remove(&request_id);
        }
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_message(state: State<'_, AppState>, request_id: String) {
    if let Some(flag) = state.in_flight.lock().get(&request_id) {
        flag.store(true, Ordering::Relaxed);
    }
}
