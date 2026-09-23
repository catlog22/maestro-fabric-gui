use crate::models::{BridgeHandshake, DesktopError};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    time::timeout,
};
use uuid::Uuid;

const MINIMUM_NODE_MAJOR: u64 = 22;

pub struct BridgeSupervisor {
    child: Option<Child>,
    input: Option<ChildStdin>,
    output: Option<BufReader<ChildStdout>>,
    script: Option<std::path::PathBuf>,
}
impl BridgeSupervisor {
    pub fn new() -> Self {
        Self {
            child: None,
            input: None,
            output: None,
            script: None,
        }
    }
    pub fn with_script(script: std::path::PathBuf) -> Self {
        Self {
            script: Some(script),
            ..Self::new()
        }
    }
    fn reset(&mut self) {
        self.child = None;
        self.input = None;
        self.output = None;
    }
    async fn ensure_started(&mut self) -> Result<(), DesktopError> {
        let running = self
            .child
            .as_mut()
            .is_some_and(|child| matches!(child.try_wait(), Ok(None)));
        if running && self.input.is_some() && self.output.is_some() {
            return Ok(());
        }
        self.reset();
        let node = std::env::var_os("MAESTRO_FABRIC_NODE_BIN")
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "node".into());
        let version = Command::new(&node)
            .arg("--version")
            .output()
            .await
            .map_err(|_| DesktopError {
                code: "bridge_dependency_missing".into(),
                message: "Node.js 22+ is required to run the desktop bridge. Install Node.js or set MAESTRO_FABRIC_NODE_BIN.".into(),
                retryable: false,
            })?;
        let major = String::from_utf8_lossy(&version.stdout);
        if !version.status.success()
            || parse_node_major(&major).is_none_or(|value| value < MINIMUM_NODE_MAJOR)
        {
            return Err(DesktopError {
                code: "bridge_dependency_incompatible".into(),
                message: "Node.js 22+ is required to run the desktop bridge.".into(),
                retryable: false,
            });
        }
        let script = self
            .script
            .clone()
            .filter(|p| p.exists())
            .or_else(|| {
                std::env::current_exe()
                    .ok()
                    .and_then(|p| {
                        p.parent()
                            .map(|d| d.join("bridge").join("dist").join("worker.js"))
                    })
                    .filter(|p| p.exists())
            })
            .unwrap_or_else(|| std::path::PathBuf::from("bridge/dist/worker.js"));
        let mut child = Command::new(&node)
            .arg(script)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| DesktopError {
                code: "bridge_start_failed".into(),
                message: format!("Unable to start the desktop bridge: {e}"),
                retryable: true,
            })?;
        self.input = child.stdin.take();
        self.output = child.stdout.take().map(BufReader::new);
        self.child = Some(child);
        Ok(())
    }
    pub async fn request(
        &mut self,
        action: &str,
        payload: Value,
        deadline: Duration,
    ) -> Result<Value, DesktopError> {
        self.ensure_started().await?;
        let id = Uuid::new_v4().to_string();
        let request = json!({"id":id,"action":action,"deadlineAt": chrono_millis() + deadline.as_millis() as u64,"payload":payload});
        let write_result = async {
            let input = self
                .input
                .as_mut()
                .ok_or_else(|| unavailable("Bridge input is unavailable"))?;
            input
                .write_all(format!("{}\n", request).as_bytes())
                .await
                .map_err(|_| unavailable("Bridge input closed"))?;
            input
                .flush()
                .await
                .map_err(|_| unavailable("Bridge input closed"))
        }
        .await;
        if let Err(error) = write_result {
            self.reset();
            return Err(error);
        }
        let mut line = String::new();
        let output = self
            .output
            .as_mut()
            .ok_or_else(|| unavailable("Bridge output is unavailable"))?;
        let read = match timeout(deadline, output.read_line(&mut line)).await {
            Ok(Ok(value)) => value,
            Ok(Err(_)) => {
                self.reset();
                return Err(unavailable("Bridge output closed"));
            }
            Err(_) => {
                self.reset();
                return Err(DesktopError {
                    code: "deadline_exceeded".into(),
                    message: "Bridge request timed out".into(),
                    retryable: true,
                });
            }
        };
        if read == 0 {
            self.reset();
            return Err(unavailable("Bridge output closed"));
        }
        let envelope: Value =
            serde_json::from_str(&line).map_err(|_| unavailable("Bridge returned invalid JSON"))?;
        if envelope.get("id").and_then(Value::as_str) != Some(id.as_str()) {
            self.reset();
            return Err(unavailable("Bridge response did not match the request"));
        }
        if envelope.get("ok") != Some(&Value::Bool(true)) {
            return Err(serde_json::from_value(
                envelope.get("error").cloned().unwrap_or(Value::Null),
            )
            .unwrap_or_else(|_| unavailable("Bridge rejected the request")));
        }
        Ok(envelope.get("result").cloned().unwrap_or(Value::Null))
    }
    pub async fn handshake(&mut self, deadline: Duration) -> Result<BridgeHandshake, DesktopError> {
        let result = self.request("handshake", json!({}), deadline).await?;
        serde_json::from_value(result)
            .map_err(|_| unavailable("Bridge returned an incompatible handshake"))
    }
}
fn parse_node_major(version: &str) -> Option<u64> {
    version
        .trim()
        .strip_prefix('v')?
        .split('.')
        .next()?
        .parse()
        .ok()
}

fn unavailable(message: &str) -> DesktopError {
    DesktopError {
        code: "bridge_unavailable".into(),
        message: message.into(),
        retryable: true,
    }
}
fn chrono_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn starts_empty() {
        let value = BridgeSupervisor::new();
        assert!(value.child.is_none());
    }

    #[test]
    fn parses_supported_node_versions() {
        assert_eq!(parse_node_major("v22.18.0\n"), Some(22));
        assert_eq!(parse_node_major("v24.1.0"), Some(24));
        assert_eq!(parse_node_major("22.18.0"), None);
    }
}
