//! Claude integration.
//!
//! All network access to the Anthropic API happens here, in Rust, so the API
//! key never enters the webview. Responses are streamed back to the frontend as
//! Tauri events.

pub mod claude;
pub mod ollama;

pub use claude::{stream_chat, ChatMessage, ChatRequest};

/// A model AURA can be pointed at, with the pricing shown in Settings so the
/// cost of a choice is visible at the point of choosing.
pub struct ModelInfo {
    pub id: &'static str,
    pub label: &'static str,
    /// USD per million input tokens.
    pub input_price: f64,
    /// USD per million output tokens.
    pub output_price: f64,
    /// Whether `output_config.effort` is accepted.
    pub supports_effort: bool,
    /// Whether the model runs adaptive thinking (affects nothing we send, but
    /// explains the pause before the first token).
    pub thinks: bool,
    pub note: &'static str,
}

/// Ordered cheapest-first, because for a companion that talks in one-liners the
/// cheap models are the sensible default and the expensive ones are the upgrade.
pub const MODELS: &[ModelInfo] = &[
    ModelInfo {
        id: "claude-haiku-4-5",
        label: "Claude Haiku 4.5",
        input_price: 1.0,
        output_price: 5.0,
        supports_effort: false,
        thinks: false,
        note: "Default. Fastest and cheapest, and answers instantly — well suited to short conversational replies.",
    },
    ModelInfo {
        id: "claude-sonnet-5",
        label: "Claude Sonnet 5",
        input_price: 3.0,
        output_price: 15.0,
        supports_effort: true,
        thinks: true,
        note: "Noticeably sharper on real questions. Pauses to think first.",
    },
    ModelInfo {
        id: "claude-opus-5",
        label: "Claude Opus 5",
        input_price: 5.0,
        output_price: 25.0,
        supports_effort: true,
        thinks: true,
        note: "Best reasoning and the most personality, at five times Haiku's price.",
    },
];

pub fn model_info(id: &str) -> Option<&'static ModelInfo> {
    MODELS.iter().find(|m| m.id == id)
}

pub fn is_supported_model(id: &str) -> bool {
    model_info(id).is_some()
}
