//! Streaming client for the Anthropic Messages API (raw HTTP + SSE).
//!
//! Rust has no official Anthropic SDK, so this speaks the REST API directly.
//! Text arrives as `aura://ai-delta` events; the frontend renders them as AURA
//! speaks. Every failure path resolves to a typed error the UI can phrase in
//! character instead of a stack trace.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::ai::model_info;
use crate::secrets;

const API_URL: &str = "https://api.anthropic.com/v1/messages";
const API_VERSION: &str = "2023-06-01";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_ATTEMPTS: u32 = 3;

#[derive(Debug, Clone, Deserialize)]
pub struct ChatMessage {
    /// `user` or `assistant`.
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    /// Correlates every event of one exchange; also the cancellation handle.
    pub request_id: String,
    pub system: String,
    pub messages: Vec<ChatMessage>,
    /// Base64 PNG attached to the final user turn, for "look at my screen".
    #[serde(default)]
    pub image_png_base64: Option<String>,
}

/// Everything the caller must supply that comes from settings rather than the UI.
pub struct ChatConfig {
    pub model: String,
    pub effort: String,
    pub max_tokens: u32,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ErrorKind {
    NoKey,
    Auth,
    RateLimit,
    Overloaded,
    Network,
    Timeout,
    Refusal,
    BadRequest,
    Malformed,
    Cancelled,
}

impl ErrorKind {
    fn retryable(self) -> bool {
        matches!(
            self,
            ErrorKind::RateLimit | ErrorKind::Overloaded | ErrorKind::Network | ErrorKind::Timeout
        )
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorPayload {
    id: String,
    kind: ErrorKind,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeltaPayload {
    id: String,
    text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PhasePayload {
    id: String,
    /// `thinking` while the model reasons, `speaking` once text begins.
    phase: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DonePayload {
    id: String,
    stop_reason: Option<String>,
    input_tokens: u64,
    output_tokens: u64,
}

struct StreamError {
    kind: ErrorKind,
    message: String,
}

impl StreamError {
    fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

/// Build the request body. Model families differ in which knobs they accept:
/// `output_config.effort` is rejected by Haiku 4.5, and thinking is left at the
/// model default everywhere (adaptive on Opus 5 / Sonnet 5, off on Haiku).
fn build_body(req: &ChatRequest, cfg: &ChatConfig) -> Value {
    let mut messages: Vec<Value> = Vec::with_capacity(req.messages.len());
    let last = req.messages.len().saturating_sub(1);

    for (i, m) in req.messages.iter().enumerate() {
        let role = if m.role == "assistant" {
            "assistant"
        } else {
            "user"
        };

        // The screenshot rides on the final user turn, before its text, which
        // is where the API expects an image relative to the question about it.
        let attach_image = i == last && role == "user" && req.image_png_base64.is_some();

        if attach_image {
            let data = req.image_png_base64.as_deref().unwrap_or_default();
            messages.push(json!({
                "role": role,
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": data
                        }
                    },
                    { "type": "text", "text": m.content }
                ]
            }));
        } else {
            messages.push(json!({ "role": role, "content": m.content }));
        }
    }

    let mut body = json!({
        "model": cfg.model,
        "max_tokens": cfg.max_tokens,
        "stream": true,
        "system": req.system,
        "messages": messages,
    });

    let supports_effort = model_info(&cfg.model).map(|m| m.supports_effort).unwrap_or(false);
    if supports_effort {
        body["output_config"] = json!({ "effort": cfg.effort });
    }

    body
}

fn classify_status(status: u16, body: &str) -> StreamError {
    let detail = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| {
            v.get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .map(str::to_owned)
        })
        .unwrap_or_else(|| body.chars().take(300).collect());

    match status {
        401 | 403 => StreamError::new(
            ErrorKind::Auth,
            "That API key was rejected. Check it in Settings.",
        ),
        404 => StreamError::new(
            ErrorKind::BadRequest,
            format!("Model not found — pick another in Settings. ({detail})"),
        ),
        429 => StreamError::new(ErrorKind::RateLimit, "Rate limited."),
        400 | 413 | 422 => StreamError::new(ErrorKind::BadRequest, detail),
        500..=599 => StreamError::new(ErrorKind::Overloaded, "The API is having a moment."),
        _ => StreamError::new(ErrorKind::BadRequest, format!("HTTP {status}: {detail}")),
    }
}

/// One streaming attempt. Returns `Ok(true)` if any text was emitted, which
/// makes the attempt non-retryable (we must not replay half a sentence).
async fn attempt(
    app: &AppHandle,
    req: &ChatRequest,
    cfg: &ChatConfig,
    api_key: &str,
    cancelled: &Arc<AtomicBool>,
    emitted: &mut bool,
) -> Result<(), StreamError> {
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .connect_timeout(CONNECT_TIMEOUT)
        .build()
        .map_err(|e| StreamError::new(ErrorKind::Network, format!("client build failed: {e}")))?;

    let response = client
        .post(API_URL)
        .header("x-api-key", api_key)
        .header("anthropic-version", API_VERSION)
        .header("content-type", "application/json")
        .json(&build_body(req, cfg))
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                StreamError::new(ErrorKind::Timeout, "The request timed out.")
            } else {
                StreamError::new(ErrorKind::Network, format!("Network error: {e}"))
            }
        })?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(classify_status(status.as_u16(), &body));
    }

    let _ = app.emit(
        "aura://ai-phase",
        PhasePayload {
            id: req.request_id.clone(),
            phase: "thinking",
        },
    );

    let mut stream = response.bytes_stream();
    let mut buffer: Vec<u8> = Vec::with_capacity(8 * 1024);
    let mut stop_reason: Option<String> = None;
    let mut input_tokens: u64 = 0;
    let mut output_tokens: u64 = 0;
    let mut speaking = false;

    while let Some(chunk) = stream.next().await {
        if cancelled.load(Ordering::Relaxed) {
            return Err(StreamError::new(ErrorKind::Cancelled, "Cancelled."));
        }

        let chunk = chunk.map_err(|e| {
            if e.is_timeout() {
                StreamError::new(ErrorKind::Timeout, "The stream timed out.")
            } else {
                StreamError::new(ErrorKind::Network, format!("Stream interrupted: {e}"))
            }
        })?;
        buffer.extend_from_slice(&chunk);

        // SSE frames are separated by a blank line. Drain every complete frame
        // and leave any partial tail in the buffer for the next chunk.
        while let Some(split) = find_frame_end(&buffer) {
            let frame = buffer.drain(..split.0).collect::<Vec<u8>>();
            buffer.drain(..split.1);
            let Ok(frame) = String::from_utf8(frame) else {
                continue;
            };

            let mut actions = Vec::new();
            parse_frame(&frame, &mut actions);

            for action in actions {
                match action {
                    StreamAction::TextStarted => {
                        if !speaking {
                            speaking = true;
                            let _ = app.emit(
                                "aura://ai-phase",
                                PhasePayload {
                                    id: req.request_id.clone(),
                                    phase: "speaking",
                                },
                            );
                        }
                    }
                    StreamAction::Text(text) => {
                        *emitted = true;
                        let _ = app.emit(
                            "aura://ai-delta",
                            DeltaPayload {
                                id: req.request_id.clone(),
                                text,
                            },
                        );
                    }
                    StreamAction::InputTokens(n) => input_tokens = n,
                    StreamAction::OutputTokens(n) => output_tokens = n,
                    StreamAction::StopReason(reason) => stop_reason = Some(reason),
                    StreamAction::ApiError(message) => {
                        return Err(StreamError::new(ErrorKind::Overloaded, message))
                    }
                }
            }
        }
    }

    // Safety classifiers can decline a request; that arrives as a successful
    // stream with no text, so it has to be checked explicitly.
    if stop_reason.as_deref() == Some("refusal") {
        return Err(StreamError::new(
            ErrorKind::Refusal,
            "I'd rather not answer that one.",
        ));
    }

    let _ = app.emit(
        "aura://ai-done",
        DonePayload {
            id: req.request_id.clone(),
            stop_reason,
            input_tokens,
            output_tokens,
        },
    );
    Ok(())
}

/// What one SSE frame asks the caller to do. Extracted from the transport so
/// the wire format can be tested without a network or an `AppHandle`.
#[derive(Debug, Clone, PartialEq, Eq)]
enum StreamAction {
    /// The first visible text block began — thinking is over, she is speaking.
    TextStarted,
    Text(String),
    StopReason(String),
    InputTokens(u64),
    OutputTokens(u64),
    ApiError(String),
}

/// Decode one SSE frame into actions. Unknown event types and unparsable data
/// are ignored rather than fatal: the API adds event types over time, and a
/// companion that dies on an unrecognised one would be worse than useless.
fn parse_frame(frame: &str, actions: &mut Vec<StreamAction>) {
    for line in frame.lines() {
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        let Ok(event) = serde_json::from_str::<Value>(data) else {
            continue;
        };

        match event.get("type").and_then(Value::as_str) {
            Some("content_block_start") => {
                // Thinking blocks also start here; only text means speech.
                let block_type = event
                    .get("content_block")
                    .and_then(|b| b.get("type"))
                    .and_then(Value::as_str);
                if block_type == Some("text") {
                    actions.push(StreamAction::TextStarted);
                }
            }
            Some("content_block_delta") => {
                let delta = event.get("delta");
                let is_text =
                    delta.and_then(|d| d.get("type")).and_then(Value::as_str) == Some("text_delta");
                if is_text {
                    if let Some(text) = delta.and_then(|d| d.get("text")).and_then(Value::as_str) {
                        if !text.is_empty() {
                            actions.push(StreamAction::Text(text.to_string()));
                        }
                    }
                }
            }
            Some("message_start") => {
                if let Some(usage) = event.get("message").and_then(|m| m.get("usage")) {
                    if let Some(n) = usage.get("input_tokens").and_then(Value::as_u64) {
                        actions.push(StreamAction::InputTokens(n));
                    }
                }
            }
            Some("message_delta") => {
                if let Some(reason) = event
                    .get("delta")
                    .and_then(|d| d.get("stop_reason"))
                    .and_then(Value::as_str)
                {
                    actions.push(StreamAction::StopReason(reason.to_string()));
                }
                if let Some(n) = event
                    .get("usage")
                    .and_then(|u| u.get("output_tokens"))
                    .and_then(Value::as_u64)
                {
                    actions.push(StreamAction::OutputTokens(n));
                }
            }
            Some("error") => {
                let message = event
                    .get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(Value::as_str)
                    .unwrap_or("The API returned an error mid-stream.")
                    .to_string();
                actions.push(StreamAction::ApiError(message));
            }
            _ => {}
        }
    }
}

/// Index of the end of the first complete SSE frame: `(payload_len, sep_len)`.
fn find_frame_end(buf: &[u8]) -> Option<(usize, usize)> {
    let mut i = 0;
    while i + 1 < buf.len() {
        if buf[i] == b'\n' && buf[i + 1] == b'\n' {
            return Some((i, 2));
        }
        if i + 3 < buf.len()
            && buf[i] == b'\r'
            && buf[i + 1] == b'\n'
            && buf[i + 2] == b'\r'
            && buf[i + 3] == b'\n'
        {
            return Some((i, 4));
        }
        i += 1;
    }
    None
}

/// Run a full exchange, retrying transient failures until text starts flowing.
pub async fn stream_chat(
    app: AppHandle,
    req: ChatRequest,
    cfg: ChatConfig,
    cancelled: Arc<AtomicBool>,
) {
    let Some(api_key) = secrets::get_api_key() else {
        let _ = app.emit(
            "aura://ai-error",
            ErrorPayload {
                id: req.request_id,
                kind: ErrorKind::NoKey,
                message: "No API key yet. Add one in Settings and we can talk properly."
                    .to_string(),
            },
        );
        return;
    };

    let mut emitted = false;
    let mut last: StreamError = StreamError::new(ErrorKind::Network, "Unknown failure.");

    for attempt_no in 1..=MAX_ATTEMPTS {
        if cancelled.load(Ordering::Relaxed) {
            last = StreamError::new(ErrorKind::Cancelled, "Cancelled.");
            break;
        }

        match attempt(&app, &req, &cfg, &api_key, &cancelled, &mut emitted).await {
            Ok(()) => return,
            Err(e) => {
                let can_retry = e.kind.retryable() && !emitted && attempt_no < MAX_ATTEMPTS;
                last = e;
                if !can_retry {
                    break;
                }
                // 1s, then 3s — enough to ride out a blip without stalling the UI.
                let backoff = Duration::from_millis(1000 * (attempt_no as u64) * 2 - 1000);
                tokio::time::sleep(backoff).await;
            }
        }
    }

    if matches!(last.kind, ErrorKind::Cancelled) {
        // A cancelled turn already has whatever text it produced on screen.
        let _ = app.emit(
            "aura://ai-done",
            DonePayload {
                id: req.request_id,
                stop_reason: Some("cancelled".into()),
                input_tokens: 0,
                output_tokens: 0,
            },
        );
        return;
    }

    let _ = app.emit(
        "aura://ai-error",
        ErrorPayload {
            id: req.request_id,
            kind: last.kind,
            message: last.message,
        },
    );
}

/// Cheapest possible round-trip to confirm the stored key works. Used by the
/// "Test key" button in Settings; the reply is discarded.
pub async fn verify_key(model: &str) -> Result<String, String> {
    let Some(api_key) = secrets::get_api_key() else {
        return Err("No API key saved yet.".into());
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("client build failed: {e}"))?;

    let response = client
        .post(API_URL)
        .header("x-api-key", api_key)
        .header("anthropic-version", API_VERSION)
        .header("content-type", "application/json")
        .json(&json!({
            "model": model,
            "max_tokens": 16,
            "messages": [{ "role": "user", "content": "Reply with the word: ok" }],
        }))
        .send()
        .await
        .map_err(|e| format!("Could not reach the API: {e}"))?;

    let status = response.status();
    if status.is_success() {
        Ok(format!("Key works with {model}."))
    } else {
        let body = response.text().await.unwrap_or_default();
        Err(classify_status(status.as_u16(), &body).message)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_end_handles_lf_and_crlf() {
        assert_eq!(find_frame_end(b"data: {}\n\nrest"), Some((8, 2)));
        assert_eq!(find_frame_end(b"data: {}\r\n\r\nrest"), Some((8, 4)));
        assert_eq!(find_frame_end(b"data: {} partial"), None);
    }

    /// Drive the byte-level framing exactly as `attempt` does, so the test
    /// covers chunk boundaries as well as frame decoding.
    fn drive(chunks: &[&str]) -> Vec<StreamAction> {
        let mut buffer: Vec<u8> = Vec::new();
        let mut actions = Vec::new();
        for chunk in chunks {
            buffer.extend_from_slice(chunk.as_bytes());
            while let Some((len, sep)) = find_frame_end(&buffer) {
                let frame: Vec<u8> = buffer.drain(..len).collect();
                buffer.drain(..sep);
                parse_frame(&String::from_utf8(frame).unwrap(), &mut actions);
            }
        }
        actions
    }

    /// A representative Opus 5 stream: a thinking block with no visible text,
    /// then the reply, then usage and stop reason.
    const SAMPLE_STREAM: &str = concat!(
        "event: message_start\n",
        r#"data: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":412,"output_tokens":1}}}"#,
        "\n\n",
        "event: content_block_start\n",
        r#"data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}"#,
        "\n\n",
        "event: content_block_delta\n",
        r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":""}}"#,
        "\n\n",
        "event: content_block_stop\n",
        r#"data: {"type":"content_block_stop","index":0}"#,
        "\n\n",
        "event: content_block_start\n",
        r#"data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}"#,
        "\n\n",
        "event: content_block_delta\n",
        r#"data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Back to "}}"#,
        "\n\n",
        "event: content_block_delta\n",
        r#"data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"coding, then."}}"#,
        "\n\n",
        "event: message_delta\n",
        r#"data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":9}}"#,
        "\n\n",
        "event: message_stop\n",
        r#"data: {"type":"message_stop"}"#,
        "\n\n",
    );

    #[test]
    fn parses_a_full_streamed_reply() {
        let actions = drive(&[SAMPLE_STREAM]);
        assert_eq!(
            actions,
            vec![
                StreamAction::InputTokens(412),
                // The thinking block must not be mistaken for speech.
                StreamAction::TextStarted,
                StreamAction::Text("Back to ".into()),
                StreamAction::Text("coding, then.".into()),
                StreamAction::StopReason("end_turn".into()),
                StreamAction::OutputTokens(9),
            ]
        );
    }

    #[test]
    fn frames_split_across_chunks_are_reassembled() {
        // Network chunks land wherever they land, including mid-token.
        let mid = SAMPLE_STREAM.len() / 2;
        let split = SAMPLE_STREAM
            .char_indices()
            .map(|(i, _)| i)
            .find(|i| *i >= mid)
            .unwrap();
        let (a, b) = SAMPLE_STREAM.split_at(split);
        assert_eq!(drive(&[a, b]), drive(&[SAMPLE_STREAM]));

        // And byte-at-a-time, the pathological case.
        let bytewise: Vec<&str> = SAMPLE_STREAM.split_inclusive(|_| true).collect();
        assert_eq!(drive(&bytewise), drive(&[SAMPLE_STREAM]));
    }

    #[test]
    fn text_is_recovered_from_a_refusal_free_stream_with_unknown_events() {
        let stream = concat!(
            "event: ping\ndata: {\"type\":\"ping\"}\n\n",
            "event: content_block_start\n",
            r#"data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#,
            "\n\n",
            "event: something_new\ndata: {\"type\":\"something_new\",\"payload\":1}\n\n",
            "event: content_block_delta\n",
            r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}"#,
            "\n\n",
        );
        assert_eq!(
            drive(&[stream]),
            vec![StreamAction::TextStarted, StreamAction::Text("ok".into())]
        );
    }

    #[test]
    fn a_refusal_is_reported_as_a_stop_reason() {
        let stream = concat!(
            "event: message_delta\n",
            r#"data: {"type":"message_delta","delta":{"stop_reason":"refusal"},"usage":{"output_tokens":0}}"#,
            "\n\n",
        );
        assert!(drive(&[stream]).contains(&StreamAction::StopReason("refusal".into())));
    }

    #[test]
    fn mid_stream_errors_surface() {
        let stream = concat!(
            "event: error\n",
            r#"data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#,
            "\n\n",
        );
        assert_eq!(
            drive(&[stream]),
            vec![StreamAction::ApiError("Overloaded".into())]
        );
    }

    #[test]
    fn transient_failures_retry_but_refusals_do_not() {
        assert!(ErrorKind::RateLimit.retryable());
        assert!(ErrorKind::Overloaded.retryable());
        assert!(ErrorKind::Network.retryable());
        assert!(!ErrorKind::Auth.retryable());
        assert!(!ErrorKind::Refusal.retryable());
        assert!(!ErrorKind::NoKey.retryable());
    }

    #[test]
    fn http_failures_map_to_actionable_kinds() {
        assert!(matches!(
            classify_status(401, "{}").kind,
            ErrorKind::Auth
        ));
        assert!(matches!(
            classify_status(429, "{}").kind,
            ErrorKind::RateLimit
        ));
        assert!(matches!(
            classify_status(529, "{}").kind,
            ErrorKind::Overloaded
        ));
        let bad = classify_status(
            400,
            r#"{"error":{"type":"invalid_request_error","message":"max_tokens too large"}}"#,
        );
        assert!(matches!(bad.kind, ErrorKind::BadRequest));
        assert!(bad.message.contains("max_tokens"));
    }

    #[test]
    fn effort_is_omitted_for_models_that_reject_it() {
        let req = ChatRequest {
            request_id: "r1".into(),
            system: "s".into(),
            messages: vec![ChatMessage {
                role: "user".into(),
                content: "hi".into(),
            }],
            image_png_base64: None,
        };

        let haiku = build_body(
            &req,
            &ChatConfig {
                model: "claude-haiku-4-5".into(),
                effort: "low".into(),
                max_tokens: 1000,
            },
        );
        assert!(haiku.get("output_config").is_none());

        let opus = build_body(
            &req,
            &ChatConfig {
                model: "claude-opus-5".into(),
                effort: "low".into(),
                max_tokens: 1000,
            },
        );
        assert_eq!(opus["output_config"]["effort"], "low");
    }

    #[test]
    fn image_rides_on_the_final_user_turn() {
        let req = ChatRequest {
            request_id: "r1".into(),
            system: "s".into(),
            messages: vec![
                ChatMessage {
                    role: "user".into(),
                    content: "earlier".into(),
                },
                ChatMessage {
                    role: "assistant".into(),
                    content: "ok".into(),
                },
                ChatMessage {
                    role: "user".into(),
                    content: "what's on my screen".into(),
                },
            ],
            image_png_base64: Some("AAAA".into()),
        };
        let body = build_body(
            &req,
            &ChatConfig {
                model: "claude-opus-5".into(),
                effort: "low".into(),
                max_tokens: 1000,
            },
        );
        let messages = body["messages"].as_array().unwrap();
        assert!(messages[0]["content"].is_string());
        let final_blocks = messages[2]["content"].as_array().unwrap();
        assert_eq!(final_blocks[0]["type"], "image");
        assert_eq!(final_blocks[1]["type"], "text");
    }
}
