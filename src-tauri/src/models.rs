use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BridgeHandshake {
    pub protocol_version: u8,
    pub bridge_version: String,
    pub node_version: String,
    pub readiness: String,
    pub capabilities: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopError { pub code: String, pub message: String, pub retryable: bool }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopState { pub revision: u64, pub readiness: String, pub bridge: Option<BridgeHandshake>, pub error: Option<DesktopError> }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandshakeRequest { pub deadline_ms: u64 }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelRequest { pub operation_id: String }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeActionRequest {
    pub action: String,
    #[serde(default)]
    pub payload: serde_json::Value,
    #[serde(default = "default_deadline_ms")]
    pub deadline_ms: u64,
}
fn default_deadline_ms() -> u64 { 30_000 }
