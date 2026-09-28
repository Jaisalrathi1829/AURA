//! Conversation commands, routed to whichever engine is selected.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::ai::claude::{ChatConfig, ChatRequest};
use crate::ai::ollama::{self, OllamaConfig, OllamaModel};
use crate::secrets;
use crate::settings::Settings;
use crate::state::AppState;

/// Start a streamed exchange. Returns immediately; text arrives as
/// `aura://ai-delta` events keyed by `requestId`, whatever the engine.
#[tauri::command]
pub fn send_message(
    app: AppHandle,
    state: State<'_, AppState>,
    mut request: ChatRequest,
) -> Result<(), String> {
    let settings = state.settings_snapshot();

    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut in_flight = state.in_flight.lock();
        // One exchange at a time — a new send supersedes the previous one.
        for flag in in_flight.values() {
            flag.store(true, Ordering::Relaxed);
        }
        in_flight.clear();
        in_flight.insert(request.request_id.clone(), cancel.clone());
    }

    let request_id = request.request_id.clone();
    let app_for_task = app.clone();

    if settings.engine == "ollama" {
        // A screenshot only goes to a model that can see. Without one the
        // frontend has already put the screen's text into the message.
        let model = if request.image_png_base64.is_some() && !settings.ollama_vision_model.is_empty() {
            settings.ollama_vision_model.clone()
        } else {
            request.image_png_base64 = None;
            settings.ollama_model.clone()
        };
        let config = OllamaConfig {
            base_url: settings.ollama_url.clone(),
            model,
            max_tokens: settings.response_length.local_max_tokens(),
        };
        tauri::async_runtime::spawn(async move {
            ollama::stream_chat(app_for_task.clone(), request, config, cancel).await;
            clear_in_flight(&app_for_task, &request_id);
        });
    } else {
        let config = ChatConfig {
            model: settings.model.clone(),
            effort: settings.effort.clone(),
            max_tokens: settings.response_length.max_tokens(),
        };
        tauri::async_runtime::spawn(async move {
            crate::ai::stream_chat(app_for_task.clone(), request, config, cancel).await;
            clear_in_flight(&app_for_task, &request_id);
        });
    }

    Ok(())
}

fn clear_in_flight(app: &AppHandle, request_id: &str) {
    if let Some(state) = app.try_state::<AppState>() {
        state.in_flight.lock().remove(request_id);
    }
}

#[tauri::command]
pub fn cancel_message(state: State<'_, AppState>, request_id: String) {
    if let Some(flag) = state.in_flight.lock().get(&request_id) {
        flag.store(true, Ordering::Relaxed);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    /// `ollama` or `claude`.
    pub engine: String,
    /// The model replies come from.
    pub model: String,
    /// Can AURA hold a conversation right now?
    pub ready: bool,
    /// Can the screen be sent as an image, rather than read as text?
    pub vision: bool,
    /// The model used for screen images, if different from `model`.
    pub vision_model: Option<String>,
    /// Human explanation, shown in Settings and when something is wrong.
    pub detail: String,
}

async fn status_for(settings: &Settings) -> EngineStatus {
    if settings.engine != "ollama" {
        let ready = secrets::has_api_key();
        return EngineStatus {
            engine: "claude".into(),
            model: settings.model.clone(),
            ready,
            // Every Claude model AURA offers accepts images.
            vision: true,
            vision_model: None,
            detail: if ready {
                format!("Using {} via the Claude API.", settings.model)
            } else {
                "No Claude API key saved.".into()
            },
        };
    }

    let models = match ollama::list_models(&settings.ollama_url).await {
        Ok(m) => m,
        Err(e) => {
            return EngineStatus {
                engine: "ollama".into(),
                model: settings.ollama_model.clone(),
                ready: false,
                vision: false,
                vision_model: None,
                detail: e,
            }
        }
    };

    let find = |name: &str| models.iter().find(|m| m.name == name);
    let Some(main) = find(&settings.ollama_model) else {
        return EngineStatus {
            engine: "ollama".into(),
            model: settings.ollama_model.clone(),
            ready: false,
            vision: false,
            vision_model: None,
            detail: format!("'{}' isn't installed in Ollama.", settings.ollama_model),
        };
    };

    let vision_model = if !settings.ollama_vision_model.is_empty() {
        find(&settings.ollama_vision_model)
            .filter(|m| m.vision)
            .map(|m| m.name.clone())
    } else if main.vision {
        Some(main.name.clone())
    } else {
        None
    };

    let detail = match &vision_model {
        Some(v) if *v == main.name => format!("Thinking with {} locally; it can see images.", main.name),
        Some(v) => format!("Thinking with {} locally; screens go to {v}.", main.name),
        None => format!(
            "Thinking with {} locally. It can't see images, so the screen is read with on-device OCR.",
            main.name
        ),
    };

    EngineStatus {
        engine: "ollama".into(),
        model: main.name.clone(),
        ready: true,
        vision: vision_model.is_some(),
        vision_model,
        detail,
    }
}

#[tauri::command]
pub async fn engine_status(state: State<'_, AppState>) -> Result<EngineStatus, String> {
    let settings = state.settings_snapshot();
    Ok(status_for(&settings).await)
}

#[tauri::command]
pub async fn list_ollama_models(state: State<'_, AppState>) -> Result<Vec<OllamaModel>, String> {
    let url = state.settings_snapshot().ollama_url;
    ollama::list_models(&url).await
}

/// Load the selected local model and get one word out of it.
#[tauri::command]
pub async fn test_engine(state: State<'_, AppState>) -> Result<String, String> {
    let settings = state.settings_snapshot();
    if settings.engine == "ollama" {
        ollama::verify(&settings.ollama_url, &settings.ollama_model).await
    } else {
        crate::ai::claude::verify_key(&settings.model).await
    }
}
