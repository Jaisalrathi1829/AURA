//! Local engine: a model served by Ollama on this machine.
//!
//! Emits exactly the same `aura://ai-*` events as the Claude client, so the
//! character, chat panel and reaction system are unaware which engine is
//! running. Ollama streams newline-delimited JSON rather than SSE.
//!
//! The server address is restricted to loopback (see [`validate_base_url`]):
//! the point of a local engine is that conversations and screen contents never
//! leave the machine, and a mistyped URL should not quietly change that.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::ai::claude::{
    ChatRequest, DeltaPayload, DonePayload, ErrorKind, ErrorPayload, PhasePayload,
};

pub const DEFAULT_URL: &str = "http://127.0.0.1:11434";
pub const DEFAULT_MODEL: &str = "dolphin-mistral:7b-v2.8-q5_K_M";

/// Generous: the first request after idle loads several GB of weights.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(240);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(4);
/// Keep the model resident between messages so replies after the first are
/// quick, without pinning several GB of RAM forever once AURA goes quiet.
const KEEP_ALIVE: &str = "20m";
/// Enough room for the system prompt, a dozen turns and a page of OCR text.
const CONTEXT_TOKENS: u32 = 8192;

pub struct OllamaConfig {
    pub base_url: String,
    pub model: String,
    pub max_tokens: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaModel {
    pub name: String,
    pub size_bytes: u64,
    pub vision: bool,
    pub thinking: bool,
}

/// Accept only http(s) URLs on a loopback host. Returns the normalised URL.
pub fn validate_base_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_end_matches('/');
    let rest = trimmed
        .strip_prefix("http://")
        .or_else(|| trimmed.strip_prefix("https://"))?;
    let authority = rest.split('/').next().unwrap_or_default();
    // Strip the port, handling bracketed IPv6.
    let host = if let Some(v6) = authority.strip_prefix('[') {
        v6.split(']').next().unwrap_or_default()
    } else {
        authority.split(':').next().unwrap_or_default()
    };
    let loopback = matches!(host, "127.0.0.1" | "localhost" | "::1")
        || host.starts_with("127.");
    if loopback && !authority.is_empty() {
        Some(trimmed.to_string())
    } else {
        None
    }
}

fn client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(timeout)
        .connect_timeout(CONNECT_TIMEOUT)
        .build()
        .map_err(|e| format!("client build failed: {e}"))
}

fn offline_message() -> String {
    "Ollama isn't answering. Start it (open the Ollama app), then try again.".to_string()
}

/// Installed models, with the capabilities that matter to AURA.
pub async fn list_models(base_url: &str) -> Result<Vec<OllamaModel>, String> {
    let http = client(Duration::from_secs(15))?;
    let tags: Value = http
        .get(format!("{base_url}/api/tags"))
        .send()
        .await
        .map_err(|_| offline_message())?
        .json()
        .await
        .map_err(|e| format!("Unexpected reply from Ollama: {e}"))?;

    let names: Vec<(String, u64)> = tags
        .get("models")
        .and_then(Value::as_array)
        .map(|models| {
            models
                .iter()
                .filter_map(|m| {
                    let name = m.get("name")?.as_str()?.to_string();
                    let size = m.get("size").and_then(Value::as_u64).unwrap_or(0);
                    Some((name, size))
                })
                .collect()
        })
        .unwrap_or_default();

    let mut out = Vec::with_capacity(names.len());
    for (name, size_bytes) in names {
        let caps = capabilities(&http, base_url, &name).await.unwrap_or_default();
        out.push(OllamaModel {
            vision: caps.iter().any(|c| c == "vision"),
            thinking: caps.iter().any(|c| c == "thinking"),
            name,
            size_bytes,
        });
    }
    Ok(out)
}

async fn capabilities(
    http: &reqwest::Client,
    base_url: &str,
    model: &str,
) -> Result<Vec<String>, String> {
    let show: Value = http
        .post(format!("{base_url}/api/show"))
        .json(&json!({ "model": model }))
        .send()
        .await
        .map_err(|_| offline_message())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    Ok(show
        .get("capabilities")
        .and_then(Value::as_array)
        .map(|caps| {
            caps.iter()
                .filter_map(|c| c.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default())
}

fn build_body(req: &ChatRequest, cfg: &OllamaConfig, with_image: bool) -> Value {
    let mut messages = Vec::with_capacity(req.messages.len() + 1);
    messages.push(json!({ "role": "system", "content": req.system }));

    let last = req.messages.len().saturating_sub(1);
    for (i, m) in req.messages.iter().enumerate() {
        let role = if m.role == "assistant" { "assistant" } else { "user" };
        let mut message = json!({ "role": role, "content": m.content });
        if with_image && i == last && role == "user" {
            if let Some(image) = &req.image_png_base64 {
                message["images"] = json!([image]);
            }
        }
        messages.push(message);
    }

    json!({
        "model": cfg.model,
        "messages": messages,
        "stream": true,
        "keep_alive": KEEP_ALIVE,
        "options": {
            "num_ctx": CONTEXT_TOKENS,
            "num_predict": cfg.max_tokens,
            // 0.7 kept dolphin-mistral in voice; higher drifted into rambling.
            "temperature": 0.7,
            // Small chat models sometimes carry on and write the user's next
            // line for them; cut that off at the turn boundary.
            "stop": ["\nUser:", "\nuser:", "\nYou:", "<|im_end|>"]
        }
    })
}

/// Removes `<think>…</think>` spans from a token stream. Some local models
/// (the Qwen3 family, for instance) reason inline; that is not speech.
#[derive(Default)]
struct ThinkFilter {
    inside: bool,
    pending: String,
}

impl ThinkFilter {
    const OPEN: &'static str = "<think>";
    const CLOSE: &'static str = "</think>";

    fn push(&mut self, chunk: &str) -> String {
        self.pending.push_str(chunk);
        let mut out = String::new();
        loop {
            let tag = if self.inside { Self::CLOSE } else { Self::OPEN };
            if let Some(at) = self.pending.find(tag) {
                if !self.inside {
                    out.push_str(&self.pending[..at]);
                }
                self.pending.drain(..at + tag.len());
                self.inside = !self.inside;
                continue;
            }
            // Hold back anything that could be the start of a tag split across
            // chunks; release the rest.
            let keep = partial_suffix(&self.pending, tag);
            let release = self.pending.len() - keep;
            if !self.inside {
                out.push_str(&self.pending[..release]);
            }
            self.pending.drain(..release);
            return out;
        }
    }

    fn finish(&mut self) -> String {
        let rest = std::mem::take(&mut self.pending);
        if self.inside {
            String::new()
        } else {
            rest
        }
    }
}

/// Length of the longest suffix of `text` that is a proper prefix of `tag`.
fn partial_suffix(text: &str, tag: &str) -> usize {
    (1..tag.len())
        .rev()
        .find(|&n| text.len() >= n && text.is_char_boundary(text.len() - n) && tag.starts_with(&text[text.len() - n..]))
        .unwrap_or(0)
}

fn emit_error(app: &AppHandle, id: &str, kind: ErrorKind, message: String) {
    let _ = app.emit(
        "aura://ai-error",
        ErrorPayload {
            id: id.to_string(),
            kind,
            message,
        },
    );
}

pub async fn stream_chat(
    app: AppHandle,
    req: ChatRequest,
    cfg: OllamaConfig,
    cancelled: Arc<AtomicBool>,
) {
    let id = req.request_id.clone();
    let with_image = req.image_png_base64.is_some();

    let http = match client(REQUEST_TIMEOUT) {
        Ok(c) => c,
        Err(e) => return emit_error(&app, &id, ErrorKind::Network, e),
    };

    // Loading weights is the local model's "thinking" — show it immediately.
    let _ = app.emit(
        "aura://ai-phase",
        PhasePayload {
            id: id.clone(),
            phase: "thinking",
        },
    );

    let response = match http
        .post(format!("{}/api/chat", cfg.base_url))
        .json(&build_body(&req, &cfg, with_image))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) if e.is_timeout() => {
            return emit_error(&app, &id, ErrorKind::Timeout, "The local model took too long.".into())
        }
        Err(_) => return emit_error(&app, &id, ErrorKind::Network, offline_message()),
    };

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let detail = serde_json::from_str::<Value>(&body)
            .ok()
            .and_then(|v| v.get("error").and_then(Value::as_str).map(str::to_owned))
            .unwrap_or(body);
        let message = if status.as_u16() == 404 || detail.contains("not found") {
            format!("Model '{}' isn't installed in Ollama. Pick another in Settings.", cfg.model)
        } else {
            format!("Ollama error: {detail}")
        };
        return emit_error(&app, &id, ErrorKind::BadRequest, message);
    }

    let mut stream = response.bytes_stream();
    let mut buffer: Vec<u8> = Vec::new();
    let mut filter = ThinkFilter::default();
    let mut speaking = false;
    let mut stop_reason: Option<String> = None;
    let mut input_tokens = 0u64;
    let mut output_tokens = 0u64;

    let emit_text = |text: String, speaking: &mut bool| {
        if text.is_empty() {
            return;
        }
        if !*speaking {
            // Local models often open with a newline or two; don't let
            // whitespace alone flip her into speaking.
            let trimmed = text.trim_start();
            if trimmed.is_empty() {
                return;
            }
            *speaking = true;
            let _ = app.emit(
                "aura://ai-phase",
                PhasePayload {
                    id: id.clone(),
                    phase: "speaking",
                },
            );
            let _ = app.emit(
                "aura://ai-delta",
                DeltaPayload {
                    id: id.clone(),
                    text: trimmed.to_string(),
                },
            );
            return;
        }
        let _ = app.emit(
            "aura://ai-delta",
            DeltaPayload {
                id: id.clone(),
                text,
            },
        );
    };

    while let Some(chunk) = stream.next().await {
        if cancelled.load(Ordering::Relaxed) {
            stop_reason = Some("cancelled".into());
            break;
        }
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) if e.is_timeout() => {
                return emit_error(&app, &id, ErrorKind::Timeout, "The local model stalled.".into())
            }
            Err(e) => {
                return emit_error(&app, &id, ErrorKind::Network, format!("Stream interrupted: {e}"))
            }
        };
        buffer.extend_from_slice(&chunk);

        while let Some(pos) = buffer.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = buffer.drain(..=pos).collect();
            match parse_line(&line) {
                Line::Text(t) => {
                    let visible = filter.push(&t);
                    emit_text(visible, &mut speaking);
                }
                Line::Done {
                    reason,
                    prompt,
                    completion,
                } => {
                    stop_reason = reason;
                    input_tokens = prompt;
                    output_tokens = completion;
                }
                Line::Error(message) => {
                    return emit_error(&app, &id, ErrorKind::BadRequest, format!("Ollama error: {message}"))
                }
                Line::Skip => {}
            }
        }
    }

    // A final line without a trailing newline.
    if !buffer.is_empty() {
        if let Line::Text(t) = parse_line(&buffer) {
            let visible = filter.push(&t);
            emit_text(visible, &mut speaking);
        }
    }
    let tail = filter.finish();
    emit_text(tail, &mut speaking);

    if !speaking && stop_reason.as_deref() != Some("cancelled") {
        return emit_error(
            &app,
            &id,
            ErrorKind::Malformed,
            "The local model returned nothing.".into(),
        );
    }

    let _ = app.emit(
        "aura://ai-done",
        DonePayload {
            id,
            stop_reason,
            input_tokens,
            output_tokens,
        },
    );
}

enum Line {
    Text(String),
    Done {
        reason: Option<String>,
        prompt: u64,
        completion: u64,
    },
    Error(String),
    Skip,
}

fn parse_line(raw: &[u8]) -> Line {
    let Ok(text) = std::str::from_utf8(raw) else {
        return Line::Skip;
    };
    let text = text.trim();
    if text.is_empty() {
        return Line::Skip;
    }
    let Ok(v) = serde_json::from_str::<Value>(text) else {
        return Line::Skip;
    };
    if let Some(err) = v.get("error").and_then(Value::as_str) {
        return Line::Error(err.to_string());
    }
    if v.get("done").and_then(Value::as_bool) == Some(true) {
        return Line::Done {
            reason: v.get("done_reason").and_then(Value::as_str).map(str::to_owned),
            prompt: v.get("prompt_eval_count").and_then(Value::as_u64).unwrap_or(0),
            completion: v.get("eval_count").and_then(Value::as_u64).unwrap_or(0),
        };
    }
    // Reasoning models may report thinking separately; only `content` is speech.
    match v
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(Value::as_str)
    {
        Some(content) if !content.is_empty() => Line::Text(content.to_string()),
        _ => Line::Skip,
    }
}

/// Round-trip a tiny prompt to confirm the model loads and answers.
pub async fn verify(base_url: &str, model: &str) -> Result<String, String> {
    let http = client(REQUEST_TIMEOUT)?;
    let response = http
        .post(format!("{base_url}/api/chat"))
        .json(&json!({
            "model": model,
            "stream": false,
            "keep_alive": KEEP_ALIVE,
            "messages": [{ "role": "user", "content": "Reply with the single word: ready" }],
            "options": { "num_predict": 12 }
        }))
        .send()
        .await
        .map_err(|_| offline_message())?;
    let status = response.status();
    let body: Value = response.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let detail = body.get("error").and_then(Value::as_str).unwrap_or("unknown error");
        return Err(format!("Ollama error: {detail}"));
    }
    let reply = body
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .chars()
        .take(40)
        .collect::<String>();
    Ok(format!("{model} is loaded and answering (\"{reply}\")."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::claude::ChatMessage;

    #[test]
    fn only_loopback_urls_are_accepted() {
        assert_eq!(validate_base_url("http://127.0.0.1:11434/").as_deref(), Some("http://127.0.0.1:11434"));
        assert!(validate_base_url("http://localhost:11434").is_some());
        assert!(validate_base_url("http://[::1]:11434").is_some());
        assert!(validate_base_url("http://192.168.1.5:11434").is_none());
        assert!(validate_base_url("http://example.com").is_none());
        assert!(validate_base_url("http://localhost.evil.com").is_none());
        assert!(validate_base_url("ftp://127.0.0.1").is_none());
    }

    #[test]
    fn parses_ndjson_stream_lines() {
        assert!(matches!(
            parse_line(br#"{"message":{"role":"assistant","content":"Hi"},"done":false}"#),
            Line::Text(t) if t == "Hi"
        ));
        match parse_line(br#"{"done":true,"done_reason":"stop","prompt_eval_count":120,"eval_count":9}"#) {
            Line::Done { reason, prompt, completion } => {
                assert_eq!(reason.as_deref(), Some("stop"));
                assert_eq!((prompt, completion), (120, 9));
            }
            _ => panic!("expected done"),
        }
        assert!(matches!(parse_line(br#"{"error":"model not found"}"#), Line::Error(_)));
        assert!(matches!(
            parse_line(br#"{"message":{"role":"assistant","content":"","thinking":"hmm"},"done":false}"#),
            Line::Skip
        ));
    }

    #[test]
    fn think_blocks_are_removed_even_when_split_across_chunks() {
        let mut f = ThinkFilter::default();
        let mut out = String::new();
        for chunk in ["Sure", ". <thi", "nk>secret reasoning</th", "ink> Here", " it is."] {
            out.push_str(&f.push(chunk));
        }
        out.push_str(&f.finish());
        assert_eq!(out, "Sure.  Here it is.");
    }

    #[test]
    fn text_without_tags_passes_through_untouched() {
        let mut f = ThinkFilter::default();
        let mut out = f.push("a < b and c <t");
        out.push_str(&f.push("ag>"));
        out.push_str(&f.finish());
        assert_eq!(out, "a < b and c <tag>");
    }

    #[test]
    fn image_is_attached_only_to_the_final_user_turn() {
        let req = ChatRequest {
            request_id: "r".into(),
            system: "sys".into(),
            messages: vec![
                ChatMessage { role: "user".into(), content: "a".into() },
                ChatMessage { role: "assistant".into(), content: "b".into() },
                ChatMessage { role: "user".into(), content: "look".into() },
            ],
            image_png_base64: Some("AAAA".into()),
        };
        let cfg = OllamaConfig {
            base_url: DEFAULT_URL.into(),
            model: "m".into(),
            max_tokens: 100,
        };
        let body = build_body(&req, &cfg, true);
        let msgs = body["messages"].as_array().unwrap();
        assert_eq!(msgs[0]["role"], "system");
        assert!(msgs[1].get("images").is_none());
        assert_eq!(msgs[3]["images"][0], "AAAA");

        let no_image = build_body(&req, &cfg, false);
        assert!(no_image["messages"][3].get("images").is_none());
    }
}
