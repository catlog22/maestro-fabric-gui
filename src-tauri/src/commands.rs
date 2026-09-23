use crate::{
    models::{
        BridgeActionRequest, CredentialImportRequest, CredentialReferenceRequest, DesktopState,
        GatewayRuntimeConfig, GatewayRuntimeState, HandshakeRequest,
    },
    state::AppState,
};
use std::{sync::Arc, time::Duration};
use tauri::State;

#[tauri::command]
pub async fn get_desktop_state(state: State<'_, Arc<AppState>>) -> Result<DesktopState, String> {
    Ok(state.snapshot.read().await.clone())
}

#[tauri::command]
pub async fn bridge_handshake(
    request: HandshakeRequest,
    state: State<'_, Arc<AppState>>,
) -> Result<DesktopState, String> {
    let result = state
        .bridge
        .lock()
        .await
        .handshake(Duration::from_millis(
            request.deadline_ms.clamp(100, 30_000),
        ))
        .await;
    let mut snapshot = state.snapshot.write().await;
    snapshot.revision += 1;
    match result {
        Ok(value) => {
            snapshot.readiness = "ready".into();
            snapshot.bridge = Some(value);
            snapshot.error = None;
        }
        Err(error) => {
            snapshot.readiness = "unavailable".into();
            snapshot.bridge = None;
            snapshot.error = Some(error);
        }
    }
    Ok(snapshot.clone())
}

#[tauri::command]
pub async fn bridge_action(
    request: BridgeActionRequest,
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    let allowed = [
        "gateway.control",
        "gateway.connect",
        "gateway.disconnect",
        "gateway.call",
        "gateway.events",
        "gateway.profiles",
    ];
    if !allowed.contains(&request.action.as_str()) {
        return Err("Desktop action is not allowed".into());
    }
    let mut payload = request.payload;
    if request.action == "gateway.control" {
        let config_path = state
            .gateway_runtime
            .lock()
            .map_err(|_| "Gateway runtime is unavailable".to_string())?
            .state()
            .config_path;
        payload = bind_gateway_config(payload, config_path)?;
    } else if request.action == "gateway.connect" {
        payload = crate::credentials::inject_credential(payload)?;
    }
    state
        .bridge
        .lock()
        .await
        .request(
            &request.action,
            payload,
            Duration::from_millis(request.deadline_ms.clamp(100, 120_000)),
        )
        .await
        .map_err(|error| {
            serde_json::to_string(&error).unwrap_or_else(|_| "Desktop bridge request failed".into())
        })
}

#[tauri::command]
pub async fn get_gateway_runtime_config(
    state: State<'_, Arc<AppState>>,
) -> Result<GatewayRuntimeConfig, String> {
    Ok(state
        .gateway_runtime
        .lock()
        .map_err(|_| "Gateway runtime is unavailable".to_string())?
        .config())
}

#[tauri::command]
pub async fn save_gateway_runtime_config(
    request: GatewayRuntimeConfig,
    state: State<'_, Arc<AppState>>,
) -> Result<GatewayRuntimeState, String> {
    state
        .gateway_runtime
        .lock()
        .map_err(|_| "Gateway runtime is unavailable".to_string())?
        .save_config(request)
}

#[tauri::command]
pub async fn get_gateway_runtime_state(
    state: State<'_, Arc<AppState>>,
) -> Result<GatewayRuntimeState, String> {
    Ok(state
        .gateway_runtime
        .lock()
        .map_err(|_| "Gateway runtime is unavailable".to_string())?
        .state())
}

#[tauri::command]
pub async fn start_gateway_runtime(
    state: State<'_, Arc<AppState>>,
) -> Result<GatewayRuntimeState, String> {
    state
        .gateway_runtime
        .lock()
        .map_err(|_| "Gateway runtime is unavailable".to_string())?
        .start()
}

#[tauri::command]
pub async fn stop_gateway_runtime(
    state: State<'_, Arc<AppState>>,
) -> Result<GatewayRuntimeState, String> {
    state
        .gateway_runtime
        .lock()
        .map_err(|_| "Gateway runtime is unavailable".to_string())?
        .stop()
}

#[tauri::command]
pub async fn restart_gateway_runtime(
    state: State<'_, Arc<AppState>>,
) -> Result<GatewayRuntimeState, String> {
    state
        .gateway_runtime
        .lock()
        .map_err(|_| "Gateway runtime is unavailable".to_string())?
        .restart()
}

fn bind_gateway_config(
    mut payload: serde_json::Value,
    config_path: String,
) -> Result<serde_json::Value, String> {
    let object = payload
        .as_object_mut()
        .ok_or_else(|| "Gateway control payload is invalid".to_string())?;
    object.insert("configPath".into(), serde_json::Value::String(config_path));
    Ok(payload)
}

#[tauri::command]
pub async fn import_gateway_credentials(request: CredentialImportRequest) -> Result<(), String> {
    crate::credentials::import_openai_env_file(
        &request.path,
        &request.tunnel_id_credential_ref,
        &request.runtime_key_credential_ref,
        request.delete_after_import,
    )
}

#[tauri::command]
pub async fn delete_gateway_credential(request: CredentialReferenceRequest) -> Result<(), String> {
    crate::credentials::delete(&request.reference)
}

#[cfg(test)]
mod tests {
    use super::bind_gateway_config;
    use serde_json::json;

    #[test]
    fn gateway_control_config_is_bound_to_the_supervisor_path() {
        let value = bind_gateway_config(
            json!({ "controlAction": "tunnel.doctor", "configPath": "C:/attacker.yaml" }),
            "C:/owned/gateway.yaml".into(),
        )
        .unwrap();
        assert_eq!(value["configPath"], "C:/owned/gateway.yaml");
    }
}
