use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use crate::{bridge_supervisor::BridgeSupervisor, models::DesktopState};

pub struct AppState {
    pub snapshot: RwLock<DesktopState>,
    pub bridge: Mutex<BridgeSupervisor>,
}
impl AppState {
    pub fn new(bridge_script: Option<std::path::PathBuf>) -> Arc<Self> {
        Arc::new(Self {
            snapshot: RwLock::new(DesktopState { revision: 0, readiness: "starting".into(), bridge: None, error: None }),
            bridge: Mutex::new(bridge_script.map(BridgeSupervisor::with_script).unwrap_or_else(BridgeSupervisor::new)),
        })
    }
}
