use crate::{
    bridge_supervisor::BridgeSupervisor, gateway_runtime::GatewayRuntimeSupervisor,
    models::DesktopState,
};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tokio::sync::{Mutex as AsyncMutex, RwLock};

pub struct AppState {
    pub snapshot: RwLock<DesktopState>,
    pub bridge: AsyncMutex<BridgeSupervisor>,
    pub gateway_runtime: Mutex<GatewayRuntimeSupervisor>,
}
impl AppState {
    pub fn new(bridge_script: Option<PathBuf>, app_data_dir: PathBuf) -> Result<Arc<Self>, String> {
        let mut gateway_runtime = GatewayRuntimeSupervisor::new(app_data_dir)?;
        gateway_runtime.bootstrap_autostart();
        Ok(Arc::new(Self {
            snapshot: RwLock::new(DesktopState {
                revision: 0,
                readiness: "starting".into(),
                bridge: None,
                error: None,
            }),
            bridge: AsyncMutex::new(
                bridge_script
                    .map(BridgeSupervisor::with_script)
                    .unwrap_or_else(BridgeSupervisor::new),
            ),
            gateway_runtime: Mutex::new(gateway_runtime),
        }))
    }
}
