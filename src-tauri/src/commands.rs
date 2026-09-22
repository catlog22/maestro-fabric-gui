use std::{sync::Arc, time::Duration};
use tauri::State;
use crate::{models::{BridgeActionRequest, CancelRequest, DesktopState, HandshakeRequest}, state::AppState};

#[tauri::command]
pub async fn get_desktop_state(state: State<'_, Arc<AppState>>) -> Result<DesktopState, String> { Ok(state.snapshot.read().await.clone()) }

#[tauri::command]
pub async fn bridge_handshake(request: HandshakeRequest, state: State<'_, Arc<AppState>>) -> Result<DesktopState, String> {
    let result = state.bridge.lock().await.handshake(Duration::from_millis(request.deadline_ms.clamp(100, 30_000))).await;
    let mut snapshot = state.snapshot.write().await; snapshot.revision += 1;
    match result { Ok(value) => { snapshot.readiness = "ready".into(); snapshot.bridge = Some(value); snapshot.error = None; }, Err(error) => { snapshot.readiness = "unavailable".into(); snapshot.bridge = None; snapshot.error = Some(error); } }
    Ok(snapshot.clone())
}

#[tauri::command]
pub async fn bridge_action(request: BridgeActionRequest, state: State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    let allowed = ["gateway.control", "gateway.connect", "gateway.disconnect", "gateway.call", "gateway.events", "gateway.profiles"];
    if !allowed.contains(&request.action.as_str()) { return Err("Desktop action is not allowed".into()); }
    let payload = if request.action == "gateway.connect" { crate::credentials::inject_credential(request.payload)? } else { request.payload };
    state.bridge.lock().await.request(&request.action, payload, Duration::from_millis(request.deadline_ms.clamp(100, 120_000))).await
        .map_err(|error| serde_json::to_string(&error).unwrap_or_else(|_| "Desktop bridge request failed".into()))
}

#[tauri::command]
pub async fn cancel_operation(request: CancelRequest, state: State<'_, Arc<AppState>>) -> Result<(), String> { state.bridge.lock().await.cancel(request.operation_id); Ok(()) }
