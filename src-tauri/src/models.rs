use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BridgeHandshake {
    pub protocol_version: u8,
    pub bridge_version: String,
    pub node_version: String,
    pub readiness: String,
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub gateway_compatibility: Option<GatewayCompatibility>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GatewayCompatibility {
    pub available: bool,
    pub minimum_version: String,
    pub compatible: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protocol_version: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopState {
    pub revision: u64,
    pub readiness: String,
    pub bridge: Option<BridgeHandshake>,
    pub error: Option<DesktopError>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandshakeRequest {
    pub deadline_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeActionRequest {
    pub action: String,
    #[serde(default)]
    pub payload: serde_json::Value,
    #[serde(default = "default_deadline_ms")]
    pub deadline_ms: u64,
}
fn default_deadline_ms() -> u64 {
    30_000
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GatewayRuntimeConfig {
    pub version: u8,
    pub desired_running: bool,
    pub server: GatewayServerConfig,
    pub tunnel: GatewayTunnelConfig,
}

impl Default for GatewayRuntimeConfig {
    fn default() -> Self {
        Self {
            version: 1,
            desired_running: false,
            server: GatewayServerConfig {
                host: "127.0.0.1".into(),
                port: 9090,
            },
            tunnel: GatewayTunnelConfig::None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GatewayServerConfig {
    pub host: String,
    pub port: u16,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum GatewayTunnelConfig {
    #[serde(rename = "none")]
    None,
    #[serde(rename = "openai-managed", rename_all = "camelCase")]
    OpenAiManaged {
        profile_id: String,
        tunnel_id_credential_ref: String,
        runtime_key_credential_ref: String,
        #[serde(default)]
        auto_install: bool,
        #[serde(default = "default_tunnel_credential_ttl_ms")]
        credential_ttl_ms: u64,
    },
    #[serde(rename = "cloudflare-quick", rename_all = "camelCase")]
    CloudflareQuick {
        profile_id: String,
        #[serde(default)]
        binary_path: Option<String>,
    },
    #[serde(rename = "cloudflare-named", rename_all = "camelCase")]
    CloudflareNamed {
        profile_id: String,
        public_url: String,
        tunnel_id: String,
        #[serde(default)]
        credentials_file: Option<String>,
        #[serde(default)]
        token_file: Option<String>,
        #[serde(default)]
        binary_path: Option<String>,
    },
    #[serde(rename = "ssh-reverse", rename_all = "camelCase")]
    SshReverse {
        profile_id: String,
        public_url: String,
        host: String,
        #[serde(default)]
        user: Option<String>,
        #[serde(default = "default_ssh_port")]
        port: u16,
        remote_port: u16,
        #[serde(default)]
        identity_file: Option<String>,
        #[serde(default)]
        binary_path: Option<String>,
    },
}

fn default_tunnel_credential_ttl_ms() -> u64 {
    300_000
}
fn default_ssh_port() -> u16 {
    22
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GatewayRuntimeStatus {
    Starting,
    Running,
    Stopped,
    Failed,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GatewayRuntimeState {
    pub status: GatewayRuntimeStatus,
    pub desired_running: bool,
    pub config_path: String,
    pub http_url: String,
    pub local_credential_ref: String,
    pub tunnel_kind: String,
    pub fabric_enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CredentialReferenceRequest {
    pub reference: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CredentialImportRequest {
    pub path: String,
    pub tunnel_id_credential_ref: String,
    pub runtime_key_credential_ref: String,
    #[serde(default)]
    pub delete_after_import: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_import_omission_preserves_the_source_file() {
        let request: CredentialImportRequest = serde_json::from_value(serde_json::json!({
            "path": "C:/secure/openai.env",
            "tunnelIdCredentialRef": "gateway.openai.tunnel-id",
            "runtimeKeyCredentialRef": "gateway.openai.runtime-key"
        }))
        .unwrap();

        assert!(!request.delete_after_import);
    }
}
