//! Shared application state.

use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use parking_lot::Mutex;

use crate::desktop::clickthrough::ClickThrough;
use crate::settings::Settings;

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub click_through: Arc<ClickThrough>,
    /// Cancellation flags for in-flight Claude requests, keyed by request id.
    pub in_flight: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl AppState {
    pub fn new(settings: Settings) -> Self {
        Self {
            settings: Mutex::new(settings),
            click_through: Arc::new(ClickThrough::new()),
            in_flight: Mutex::new(HashMap::new()),
        }
    }

    pub fn settings_snapshot(&self) -> Settings {
        self.settings.lock().clone()
    }
}
