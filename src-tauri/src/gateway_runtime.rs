use std::{
    ffi::{OsStr, OsString},
    io::Write,
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use serde_json::{json, Map, Value};
use url::Url;

use crate::{
    credentials,
    models::{
        GatewayRuntimeConfig, GatewayRuntimeState, GatewayRuntimeStatus, GatewayTunnelConfig,
    },
};

const RUNTIME_DOCUMENT_VERSION: u8 = 1;
const RUNTIME_FILE: &str = "gateway-runtime.json";
const GATEWAY_CONFIG_FILE: &str = "gateway.yaml";
const TUNNEL_ID_ENV: &str = "CONTROL_PLANE_TUNNEL_ID";
const API_KEY_ENV: &str = "CONTROL_PLANE_API_KEY";
const LOCAL_GATEWAY_CREDENTIAL_REF: &str = credentials::LOCAL_GATEWAY_CREDENTIAL_REF;
const MIN_OPENAI_TTL_MS: u64 = 60_000;
const MAX_OPENAI_TTL_MS: u64 = 3_600_000;
const STOP_TIMEOUT: Duration = Duration::from_secs(3);
const START_TIMEOUT: Duration = Duration::from_secs(10);
const START_POLL_INTERVAL: Duration = Duration::from_millis(50);
const MINIMUM_GATEWAY_VERSION: [u64; 3] = [0, 31, 3];

#[derive(Clone, Debug)]
struct RuntimePaths {
    runtime: PathBuf,
    gateway: PathBuf,
}

impl RuntimePaths {
    fn new(app_data_dir: &Path) -> Result<Self, String> {
        let root = app_data_dir.join("gateway-runtime");
        std::fs::create_dir_all(&root)
            .map_err(|_| "Gateway runtime storage is unavailable".to_string())?;
        Ok(Self {
            runtime: root.join(RUNTIME_FILE),
            gateway: root.join(GATEWAY_CONFIG_FILE),
        })
    }
}

fn remove_gateway_config_file(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("Gateway runtime credential file could not be removed".into()),
    }
}

trait CredentialResolver: Send + Sync {
    fn load(&self, reference: &str) -> Result<String, String>;
    fn store(&self, reference: &str, secret: &str) -> Result<(), String>;
}

struct KeyringCredentialResolver;
impl CredentialResolver for KeyringCredentialResolver {
    fn load(&self, reference: &str) -> Result<String, String> {
        credentials::load(reference)
    }
    fn store(&self, reference: &str, secret: &str) -> Result<(), String> {
        credentials::set(reference, secret)
    }
}

trait OwnedGatewayChild: Send {
    fn id(&self) -> u32;
    fn has_exited(&mut self) -> Result<bool, ()>;
    fn terminate(&mut self, timeout: Duration) -> Result<(), ()>;
}

struct SystemGatewayChild(Child);
impl Drop for SystemGatewayChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
    }
}
impl OwnedGatewayChild for SystemGatewayChild {
    fn id(&self) -> u32 {
        self.0.id()
    }

    fn has_exited(&mut self) -> Result<bool, ()> {
        self.0
            .try_wait()
            .map(|status| status.is_some())
            .map_err(|_| ())
    }

    fn terminate(&mut self, timeout: Duration) -> Result<(), ()> {
        if self.has_exited()? {
            return Ok(());
        }
        self.0.kill().map_err(|_| ())?;
        let deadline = Instant::now() + timeout;
        loop {
            if self.has_exited()? {
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err(());
            }
            thread::sleep(Duration::from_millis(20));
        }
    }
}

trait GatewayProcessLauncher: Send + Sync {
    fn verify(&self, _binary: &OsStr) -> Result<(), String> {
        Ok(())
    }
    fn spawn(
        &self,
        binary: &OsStr,
        arguments: &[OsString],
        environment: &[(OsString, OsString)],
    ) -> Result<Box<dyn OwnedGatewayChild>, ()>;
    fn wait_until_ready(
        &self,
        _config: &GatewayRuntimeConfig,
        _child: &mut dyn OwnedGatewayChild,
    ) -> Result<(), String> {
        Ok(())
    }
    fn request_stop(&self, _binary: &OsStr, _config_path: &Path) -> Result<(), ()> {
        Err(())
    }
}

struct SystemGatewayProcessLauncher;
impl GatewayProcessLauncher for SystemGatewayProcessLauncher {
    fn verify(&self, binary: &OsStr) -> Result<(), String> {
        let output = Command::new(binary)
            .arg("--version")
            .stdin(Stdio::null())
            .output()
            .map_err(|_| "pi-maestro-gateway is required. Install it or set PI_MAESTRO_GATEWAY_BIN to an executable path.".to_string())?;
        if !output.status.success() {
            return Err(
                "The configured pi-maestro-gateway executable failed its version check.".into(),
            );
        }
        let bytes = if output.stdout.is_empty() {
            output.stderr.as_slice()
        } else {
            output.stdout.as_slice()
        };
        let version = parse_gateway_version(bytes).ok_or_else(|| {
            "The configured pi-maestro-gateway returned an invalid version.".to_string()
        })?;
        if !gateway_version_is_supported(version) {
            return Err(format!(
                "pi-maestro-gateway {}.{}.{} or newer is required.",
                MINIMUM_GATEWAY_VERSION[0], MINIMUM_GATEWAY_VERSION[1], MINIMUM_GATEWAY_VERSION[2]
            ));
        }
        Ok(())
    }

    fn spawn(
        &self,
        binary: &OsStr,
        arguments: &[OsString],
        environment: &[(OsString, OsString)],
    ) -> Result<Box<dyn OwnedGatewayChild>, ()> {
        let mut command = Command::new(binary);
        command
            .args(arguments)
            .envs(environment.iter().cloned())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        command
            .spawn()
            .map(|child| Box::new(SystemGatewayChild(child)) as Box<dyn OwnedGatewayChild>)
            .map_err(|_| ())
    }

    fn wait_until_ready(
        &self,
        config: &GatewayRuntimeConfig,
        child: &mut dyn OwnedGatewayChild,
    ) -> Result<(), String> {
        let addresses = (config.server.host.as_str(), config.server.port)
            .to_socket_addrs()
            .map_err(|_| "Gateway readiness address could not be resolved".to_string())?
            .collect::<Vec<_>>();
        let deadline = Instant::now() + START_TIMEOUT;
        loop {
            if child.has_exited().unwrap_or(true) {
                return Err("Gateway process exited during startup".into());
            }
            if addresses
                .iter()
                .any(|address| TcpStream::connect_timeout(address, START_POLL_INTERVAL).is_ok())
            {
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err("Gateway did not become ready before the startup deadline".into());
            }
            thread::sleep(START_POLL_INTERVAL);
        }
    }

    fn request_stop(&self, binary: &OsStr, config_path: &Path) -> Result<(), ()> {
        let mut child = Command::new(binary)
            .args([
                OsStr::new("service"),
                OsStr::new("stop"),
                OsStr::new("--config"),
            ])
            .arg(config_path)
            .args([OsStr::new("--json")])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| ())?;
        let deadline = Instant::now() + Duration::from_secs(1);
        loop {
            if child.try_wait().map_err(|_| ())?.is_some() {
                return Ok(());
            }
            if Instant::now() >= deadline {
                let _ = child.kill();
                return Err(());
            }
            thread::sleep(Duration::from_millis(20));
        }
    }
}

pub struct GatewayRuntimeSupervisor {
    paths: RuntimePaths,
    config: GatewayRuntimeConfig,
    state: GatewayRuntimeState,
    child: Option<Box<dyn OwnedGatewayChild>>,
    launcher: Box<dyn GatewayProcessLauncher>,
    credentials: Box<dyn CredentialResolver>,
}

impl GatewayRuntimeSupervisor {
    pub fn new(app_data_dir: PathBuf) -> Result<Self, String> {
        Self::with_dependencies(
            app_data_dir,
            Box::new(SystemGatewayProcessLauncher),
            Box::new(KeyringCredentialResolver),
        )
    }

    fn with_dependencies(
        app_data_dir: PathBuf,
        launcher: Box<dyn GatewayProcessLauncher>,
        credentials: Box<dyn CredentialResolver>,
    ) -> Result<Self, String> {
        let paths = RuntimePaths::new(&app_data_dir)?;
        remove_gateway_config_file(&paths.gateway)?;
        let config = load_persisted(&paths.runtime)?;
        validate_config(&config)?;
        let desired_running = config.desired_running;
        let config_path = paths.gateway.to_string_lossy().into_owned();
        let http_url = runtime_http_url(&config);
        let tunnel_kind = tunnel_kind(&config.tunnel).into();
        Ok(Self {
            paths,
            config,
            state: GatewayRuntimeState {
                status: GatewayRuntimeStatus::Stopped,
                desired_running,
                config_path,
                http_url,
                local_credential_ref: LOCAL_GATEWAY_CREDENTIAL_REF.into(),
                tunnel_kind,
                fabric_enabled: false,
                pid: None,
                error: None,
            },
            child: None,
            launcher,
            credentials,
        })
    }

    pub fn bootstrap_autostart(&mut self) {
        if self.state.desired_running {
            let _ = self.start_internal(false);
        }
    }

    pub fn config(&self) -> GatewayRuntimeConfig {
        self.config.clone()
    }

    pub fn save_config(
        &mut self,
        config: GatewayRuntimeConfig,
    ) -> Result<GatewayRuntimeState, String> {
        validate_config(&config)?;
        let restart_required = self.child.is_some() && self.config != config;
        persist_runtime(&self.paths.runtime, &config)?;
        let desired_running = config.desired_running;
        self.config = config;
        self.state.desired_running = desired_running;
        self.state.http_url = runtime_http_url(&self.config);
        self.state.tunnel_kind = tunnel_kind(&self.config.tunnel).into();
        if desired_running {
            if restart_required {
                self.stop_owned(true)?;
            }
            self.start_internal(false)?;
        } else {
            self.stop_owned(false)?;
        }
        Ok(self.state())
    }

    pub fn state(&mut self) -> GatewayRuntimeState {
        self.refresh_child_state();
        self.state.clone()
    }

    pub fn start(&mut self) -> Result<GatewayRuntimeState, String> {
        self.start_internal(true)?;
        Ok(self.state())
    }

    pub fn stop(&mut self) -> Result<GatewayRuntimeState, String> {
        self.config.desired_running = false;
        self.state.desired_running = false;
        persist_runtime(&self.paths.runtime, &self.config)?;
        self.stop_owned(false)?;
        Ok(self.state.clone())
    }

    pub fn restart(&mut self) -> Result<GatewayRuntimeState, String> {
        self.config.desired_running = true;
        self.state.desired_running = true;
        persist_runtime(&self.paths.runtime, &self.config)?;
        self.stop_owned(true)?;
        self.start_internal(false)?;
        Ok(self.state())
    }

    /// Stop only the process owned by this app instance. The persisted desired
    /// state is intentionally retained so the next desktop launch may auto-start.
    pub fn shutdown_owned(&mut self) -> Result<(), String> {
        self.stop_owned(true)
    }

    fn start_internal(&mut self, persist_desired: bool) -> Result<(), String> {
        self.refresh_child_state();
        if self.child.is_some() && self.state.status == GatewayRuntimeStatus::Running {
            if persist_desired && !self.state.desired_running {
                self.config.desired_running = true;
                self.state.desired_running = true;
                persist_runtime(&self.paths.runtime, &self.config)?;
            }
            return Ok(());
        }

        validate_config(&self.config)?;
        let binary = std::env::var_os("PI_MAESTRO_GATEWAY_BIN")
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| OsString::from("pi-maestro-gateway"));
        if let Err(error) = self.launcher.verify(&binary) {
            return Err(self.fail_start(&error));
        }

        let mut environment = Vec::new();
        let openai_references = match &self.config.tunnel {
            GatewayTunnelConfig::OpenAiManaged {
                tunnel_id_credential_ref,
                runtime_key_credential_ref,
                ..
            } => Some((
                tunnel_id_credential_ref.clone(),
                runtime_key_credential_ref.clone(),
            )),
            _ => None,
        };
        if let Some((tunnel_id_reference, api_key_reference)) = openai_references {
            let tunnel_id = match self.credentials.load(&tunnel_id_reference) {
                Ok(value) => value,
                Err(_) => return Err(self.fail_start("Gateway tunnel credentials are unavailable")),
            };
            let api_key = match self.credentials.load(&api_key_reference) {
                Ok(value) => value,
                Err(_) => return Err(self.fail_start("Gateway tunnel credentials are unavailable")),
            };
            environment.push((OsString::from(TUNNEL_ID_ENV), OsString::from(tunnel_id)));
            environment.push((OsString::from(API_KEY_ENV), OsString::from(api_key)));
        }
        let bearer_token = match self.local_bearer_token() {
            Ok(value) => value,
            Err(error) => return Err(self.fail_start(&error)),
        };
        let yaml = match generate_gateway_yaml_for_state(
            &self.config,
            self.paths.gateway.parent(),
            &bearer_token,
        ) {
            Ok(value) => value,
            Err(error) => return Err(self.fail_start(&error)),
        };

        self.config.desired_running = true;
        self.state.desired_running = true;
        if persist_desired {
            persist_runtime(&self.paths.runtime, &self.config)?;
        }
        self.state.status = GatewayRuntimeStatus::Starting;
        self.state.pid = None;
        self.state.error = None;
        if let Err(error) = atomic_write(
            &self.paths.gateway,
            yaml.as_bytes(),
            "Gateway configuration could not be saved",
        ) {
            return Err(self.fail_start_with_cleanup(&error));
        }

        let arguments = vec![
            OsString::from("serve"),
            OsString::from("--config"),
            self.paths.gateway.as_os_str().to_owned(),
            OsString::from("--json"),
        ];
        match self.launcher.spawn(&binary, &arguments, &environment) {
            Ok(mut child) => {
                self.state.pid = Some(child.id());
                if let Err(error) = self.launcher.wait_until_ready(&self.config, child.as_mut()) {
                    let _ = child.terminate(STOP_TIMEOUT);
                    return Err(self.fail_start_with_cleanup(&error));
                }
                self.state.status = GatewayRuntimeStatus::Running;
                self.child = Some(child);
                Ok(())
            }
            Err(()) => Err(self.fail_start_with_cleanup("Gateway process could not be started")),
        }
    }

    fn local_bearer_token(&self) -> Result<String, String> {
        if let Ok(value) = self.credentials.load(LOCAL_GATEWAY_CREDENTIAL_REF) {
            if value.len() >= 16 {
                return Ok(value);
            }
        }
        let value = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        self.credentials
            .store(LOCAL_GATEWAY_CREDENTIAL_REF, &value)
            .map_err(|_| "Local Gateway credential could not be stored".to_string())?;
        Ok(value)
    }

    fn fail_start(&mut self, message: &str) -> String {
        self.state.status = GatewayRuntimeStatus::Failed;
        self.state.pid = None;
        self.state.error = Some(message.into());
        message.into()
    }

    fn fail_start_with_cleanup(&mut self, message: &str) -> String {
        let detail = match self.remove_gateway_config() {
            Ok(()) => message.to_string(),
            Err(cleanup) => format!("{message}; {cleanup}"),
        };
        self.fail_start(&detail)
    }

    fn remove_gateway_config(&self) -> Result<(), String> {
        remove_gateway_config_file(&self.paths.gateway)
    }

    fn stop_owned(&mut self, retain_desired: bool) -> Result<(), String> {
        let Some(mut child) = self.child.take() else {
            self.remove_gateway_config()?;
            self.state.status = GatewayRuntimeStatus::Stopped;
            self.state.pid = None;
            self.state.error = None;
            if !retain_desired {
                self.state.desired_running = false;
            }
            return Ok(());
        };
        let binary = std::env::var_os("PI_MAESTRO_GATEWAY_BIN")
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| OsString::from("pi-maestro-gateway"));
        let _ = self.launcher.request_stop(&binary, &self.paths.gateway);
        if child.terminate(STOP_TIMEOUT).is_err() {
            self.state.status = GatewayRuntimeStatus::Failed;
            self.state.pid = Some(child.id());
            self.state.error =
                Some("Gateway process could not be stopped within the deadline".into());
            self.child = Some(child);
            return Err("Gateway process could not be stopped within the deadline".into());
        }
        if let Err(error) = self.remove_gateway_config() {
            self.state.status = GatewayRuntimeStatus::Failed;
            self.state.pid = None;
            self.state.error = Some(error.clone());
            return Err(error);
        }
        self.state.status = GatewayRuntimeStatus::Stopped;
        self.state.pid = None;
        self.state.error = None;
        if !retain_desired {
            self.state.desired_running = false;
        }
        Ok(())
    }

    fn refresh_child_state(&mut self) {
        let Some(child) = self.child.as_mut() else {
            return;
        };
        match child.has_exited() {
            Ok(false) => {}
            Ok(true) | Err(()) => {
                self.child = None;
                self.state.pid = None;
                let cleanup_error = self.remove_gateway_config().err();
                if self.state.desired_running || cleanup_error.is_some() {
                    self.state.status = GatewayRuntimeStatus::Failed;
                    self.state.error = Some(
                        cleanup_error
                            .unwrap_or_else(|| "Gateway process exited unexpectedly".into()),
                    );
                } else {
                    self.state.status = GatewayRuntimeStatus::Stopped;
                    self.state.error = None;
                }
            }
        }
    }
}

fn parse_gateway_version(output: &[u8]) -> Option<([u64; 3], bool)> {
    String::from_utf8_lossy(output)
        .split_whitespace()
        .rev()
        .find_map(|token| {
            let normalized = token.trim_start_matches('v');
            let without_build = normalized.split('+').next()?;
            let (core, prerelease) = match without_build.split_once('-') {
                Some((core, _)) => (core, true),
                None => (without_build, false),
            };
            let mut parts = core.split('.');
            let version = [
                parts.next()?.parse().ok()?,
                parts.next()?.parse().ok()?,
                parts.next()?.parse().ok()?,
            ];
            parts.next().is_none().then_some((version, prerelease))
        })
}

fn gateway_version_is_supported(version: ([u64; 3], bool)) -> bool {
    version.0 > MINIMUM_GATEWAY_VERSION || (version.0 == MINIMUM_GATEWAY_VERSION && !version.1)
}

fn load_persisted(path: &Path) -> Result<GatewayRuntimeConfig, String> {
    if !path.exists() {
        return Ok(GatewayRuntimeConfig::default());
    }
    let bytes = std::fs::read(path)
        .map_err(|_| "Gateway runtime configuration could not be read".to_string())?;
    if bytes.len() > 256 * 1024 {
        return Err("Gateway runtime configuration is too large".into());
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| "Gateway runtime configuration is invalid".to_string())
}

fn persist_runtime(path: &Path, config: &GatewayRuntimeConfig) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(config)
        .map_err(|_| "Gateway runtime configuration could not be encoded".to_string())?;
    atomic_write(
        path,
        &bytes,
        "Gateway runtime configuration could not be saved",
    )
}

fn tunnel_kind(tunnel: &GatewayTunnelConfig) -> &'static str {
    match tunnel {
        GatewayTunnelConfig::None => "none",
        GatewayTunnelConfig::OpenAiManaged { .. } => "openai-managed",
        GatewayTunnelConfig::CloudflareQuick { .. } => "cloudflare-quick",
        GatewayTunnelConfig::CloudflareNamed { .. } => "cloudflare-named",
        GatewayTunnelConfig::SshReverse { .. } => "ssh-reverse",
    }
}

fn runtime_http_url(config: &GatewayRuntimeConfig) -> String {
    let host = if config.server.host.parse::<std::net::Ipv6Addr>().is_ok() {
        format!("[{}]", config.server.host)
    } else {
        config.server.host.clone()
    };
    format!("http://{host}:{}/mcp", config.server.port)
}

fn atomic_write(path: &Path, bytes: &[u8], message: &str) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| message.to_string())?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|_| message.to_string())?;
    temporary
        .write_all(bytes)
        .map_err(|_| message.to_string())?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|_| message.to_string())?;
    temporary.persist(path).map_err(|_| message.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).is_err() {
            let _ = std::fs::remove_file(path);
            return Err(message.to_string());
        }
    }
    Ok(())
}

pub fn validate_config(config: &GatewayRuntimeConfig) -> Result<(), String> {
    if config.version != RUNTIME_DOCUMENT_VERSION {
        return Err("version must be 1".into());
    }
    validate_gateway_host(&config.server.host)?;
    if config.server.port == 0 {
        return Err("server.port must be in 1..65535".into());
    }

    match &config.tunnel {
        GatewayTunnelConfig::None => {}
        GatewayTunnelConfig::OpenAiManaged {
            profile_id,
            tunnel_id_credential_ref,
            runtime_key_credential_ref,
            credential_ttl_ms,
            ..
        } => {
            validate_profile_id(profile_id)?;
            validate_credential_reference(tunnel_id_credential_ref, "tunnelIdCredentialRef")?;
            validate_credential_reference(runtime_key_credential_ref, "runtimeKeyCredentialRef")?;
            if tunnel_id_credential_ref == runtime_key_credential_ref {
                return Err("OpenAI credential references must be distinct".into());
            }
            if tunnel_id_credential_ref == LOCAL_GATEWAY_CREDENTIAL_REF
                || runtime_key_credential_ref == LOCAL_GATEWAY_CREDENTIAL_REF
            {
                return Err("The local Gateway credential reference is reserved".into());
            }
            if !(MIN_OPENAI_TTL_MS..=MAX_OPENAI_TTL_MS).contains(credential_ttl_ms) {
                return Err(format!(
                    "credentialTtlMs must be in {MIN_OPENAI_TTL_MS}..{MAX_OPENAI_TTL_MS}"
                ));
            }
        }
        GatewayTunnelConfig::CloudflareQuick {
            profile_id,
            binary_path,
        } => {
            validate_profile_id(profile_id)?;
            validate_optional_absolute_path(binary_path.as_deref(), "binaryPath")?;
        }
        GatewayTunnelConfig::CloudflareNamed {
            profile_id,
            public_url,
            tunnel_id,
            credentials_file,
            token_file,
            binary_path,
        } => {
            validate_profile_id(profile_id)?;
            validate_https_origin(public_url, "publicUrl")?;
            validate_safe_identifier(tunnel_id, "tunnelId")?;
            if credentials_file.is_some() == token_file.is_some() {
                return Err(
                    "Cloudflare Named requires exactly one credentialsFile or tokenFile".into(),
                );
            }
            validate_optional_absolute_path(credentials_file.as_deref(), "credentialsFile")?;
            validate_optional_absolute_path(token_file.as_deref(), "tokenFile")?;
            validate_optional_absolute_path(binary_path.as_deref(), "binaryPath")?;
        }
        GatewayTunnelConfig::SshReverse {
            profile_id,
            public_url,
            host,
            user,
            port,
            remote_port,
            binary_path,
            identity_file,
        } => {
            validate_profile_id(profile_id)?;
            validate_https_origin(public_url, "publicUrl")?;
            validate_host(host, true, "host")?;
            if let Some(user) = user {
                if user.is_empty()
                    || user.len() > 64
                    || user.starts_with('-')
                    || !user
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
                {
                    return Err("user must be a safe SSH user name".into());
                }
            }
            if *port == 0 || *remote_port == 0 {
                return Err("SSH ports must be in 1..65535".into());
            }
            validate_optional_absolute_path(binary_path.as_deref(), "binaryPath")?;
            validate_optional_absolute_path(identity_file.as_deref(), "identityFile")?;
        }
    }
    Ok(())
}

fn validate_profile_id(value: &str) -> Result<(), String> {
    validate_safe_identifier(value, "profileId")
}

fn validate_safe_identifier(value: &str, field: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 128
        || !value.as_bytes()[0].is_ascii_alphanumeric()
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
    {
        return Err(format!("{field} must be a safe identifier"));
    }
    Ok(())
}

fn validate_credential_reference(value: &str, field: &str) -> Result<(), String> {
    if !credentials::valid_reference(value) {
        return Err(format!("{field} is invalid"));
    }
    Ok(())
}

fn validate_gateway_host(value: &str) -> Result<(), String> {
    if value.eq_ignore_ascii_case("localhost") {
        return Ok(());
    }
    if value
        .parse::<std::net::IpAddr>()
        .is_ok_and(|address| address.is_loopback())
    {
        return Ok(());
    }
    Err("server.host must be a loopback address until TLS configuration is available".into())
}

fn validate_host(value: &str, allow_ssh_alias: bool, field: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 255
        || value.starts_with('-')
        || value.chars().any(char::is_whitespace)
    {
        return Err(format!("{field} is invalid"));
    }
    if value.parse::<std::net::IpAddr>().is_ok() {
        return Ok(());
    }
    if allow_ssh_alias
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b':' | b'-'))
    {
        return Ok(());
    }
    let valid = value.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || (allow_ssh_alias && b == b'_'))
    });
    if !valid {
        return Err(format!("{field} is invalid"));
    }
    Ok(())
}

fn validate_https_origin(value: &str, field: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 2048 {
        return Err(format!("{field} is invalid"));
    }
    let url = Url::parse(value).map_err(|_| format!("{field} must be an HTTPS origin"))?;
    let origin = url.origin().ascii_serialization();
    if url.scheme() != "https:".trim_end_matches(':')
        || url.username() != ""
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
        || origin != value
    {
        return Err(format!(
            "{field} must be an exact credential-free HTTPS origin"
        ));
    }
    Ok(())
}

fn validate_optional_absolute_path(value: Option<&str>, field: &str) -> Result<(), String> {
    let Some(value) = value else {
        return Ok(());
    };
    if value.is_empty() || value.len() > 4096 || !Path::new(value).is_absolute() {
        return Err(format!("{field} must be an absolute path"));
    }
    Ok(())
}

#[cfg(test)]
fn generate_gateway_yaml(config: &GatewayRuntimeConfig) -> Result<String, String> {
    generate_gateway_yaml_for_state(config, None, "local-bearer-token-0123456789")
}

fn generate_gateway_yaml_for_state(
    config: &GatewayRuntimeConfig,
    runtime_root: Option<&Path>,
    bearer_token: &str,
) -> Result<String, String> {
    validate_config(config)?;
    let fixed_origin = match &config.tunnel {
        GatewayTunnelConfig::CloudflareNamed { public_url, .. }
        | GatewayTunnelConfig::SshReverse { public_url, .. } => Some(public_url.as_str()),
        _ => None,
    };
    if bearer_token.len() < 16 {
        return Err("Local Gateway credential is invalid".into());
    }
    let auth = if let Some(origin) = fixed_origin {
        json!({
            "mode": "dual",
            "token": bearer_token,
            "oauth": { "password": bearer_token, "server_url": origin, "token_ttl_ms": 86_400_000 }
        })
    } else {
        json!({ "mode": "bearer", "token": bearer_token })
    };

    let mut tunnels = Map::new();
    let mut profiles = Vec::new();
    match &config.tunnel {
        GatewayTunnelConfig::None => {}
        GatewayTunnelConfig::OpenAiManaged {
            profile_id,
            credential_ttl_ms,
            auto_install,
            ..
        } => {
            let mut openai = Map::new();
            openai.insert("enabled".into(), json!(true));
            openai.insert("auto_install".into(), json!(auto_install));
            openai.insert("tunnel_id_env".into(), json!(TUNNEL_ID_ENV));
            openai.insert("runtime_key_env".into(), json!(API_KEY_ENV));
            openai.insert("minimum_version".into(), json!("0.0.14"));
            openai.insert("credential_ttl_ms".into(), json!(credential_ttl_ms));
            tunnels.insert("openai".into(), Value::Object(openai));

            let mut profile = Map::new();
            profile.insert("id".into(), json!(profile_id));
            profile.insert("enabled".into(), json!(true));
            profile.insert("provider".into(), json!("openai"));
            profile.insert("mode".into(), json!("secure"));
            profile.insert("lifecycle".into(), json!("persistent"));
            profile.insert("tunnel_id_env".into(), json!(TUNNEL_ID_ENV));
            profile.insert("runtime_key_env".into(), json!(API_KEY_ENV));
            profile.insert("credential_ttl_ms".into(), json!(credential_ttl_ms));
            profile.insert("auto_install".into(), json!(auto_install));
            profile.insert(
                "mcp_access".into(),
                json!({
                    "enabled": true,
                    "auth": { "kind": "managed-forward", "provider": "openai" },
                    "actions": ["gateway.host.status"],
                }),
            );
            profiles.push(Value::Object(profile));
        }
        GatewayTunnelConfig::CloudflareQuick {
            profile_id,
            binary_path,
        } => {
            let mut profile = json!({
                "id": profile_id, "enabled": true, "provider": "cloudflare", "mode": "quick", "lifecycle": "ephemeral"
            });
            insert_optional(&mut profile, "binary_path", binary_path.as_deref());
            profiles.push(profile);
        }
        GatewayTunnelConfig::CloudflareNamed {
            profile_id,
            public_url,
            tunnel_id,
            credentials_file,
            token_file,
            binary_path,
        } => {
            let mut profile = json!({
                "id": profile_id, "enabled": true, "provider": "cloudflare", "mode": "named", "lifecycle": "persistent",
                "public_url": public_url, "tunnel_id": tunnel_id
            });
            insert_optional(
                &mut profile,
                "credentials_file",
                credentials_file.as_deref(),
            );
            insert_optional(&mut profile, "token_file", token_file.as_deref());
            insert_optional(&mut profile, "binary_path", binary_path.as_deref());
            profiles.push(profile);
        }
        GatewayTunnelConfig::SshReverse {
            profile_id,
            public_url,
            host,
            user,
            port,
            remote_port,
            binary_path,
            identity_file,
        } => {
            let mut profile = json!({
                "id": profile_id, "enabled": true, "provider": "ssh", "mode": "reverse", "lifecycle": "persistent",
                "public_url": public_url, "host": host, "port": port, "remote_bind_host": "127.0.0.1",
                "remote_port": remote_port, "local_host": "127.0.0.1", "connect_timeout_seconds": 10,
                "server_alive_interval_seconds": 15, "server_alive_count_max": 3
            });
            insert_optional(&mut profile, "user", user.as_deref());
            insert_optional(&mut profile, "binary_path", binary_path.as_deref());
            insert_optional(&mut profile, "identity_file", identity_file.as_deref());
            profiles.push(profile);
        }
    }
    tunnels.insert("profiles".into(), Value::Array(profiles));

    let mut document = json!({
        "version": 2,
        "server": {
            "host": config.server.host,
            "port": config.server.port,
            "disable_localhost_protection": fixed_origin.is_some(),
            "trust_proxy_headers": fixed_origin.is_some(),
            "allowed_origins": [],
        },
        "auth": auth,
        "fabric": { "enabled": false },
        "transport": {
            "stdio": { "enabled": false },
            "http": {
                "enabled": true,
                "host": config.server.host,
                "port": config.server.port,
                "path": "/mcp",
                "tls": { "enabled": false },
            },
            "ssh": { "enabled": false },
        },
        "tunnels": Value::Object(tunnels),
    });
    if let Some(runtime_root) = runtime_root {
        let state_root = runtime_root.join("state");
        if let Some(object) = document.as_object_mut() {
            object.insert(
                "state".into(),
                json!({
                    "root_dir": state_root.to_string_lossy(),
                    "owner_path": state_root.join("owner.json").to_string_lossy(),
                    "workspace_registry_path": state_root.join("workspaces.json").to_string_lossy(),
                    "pairing_path": state_root.join("pairings.json").to_string_lossy(),
                    "service_manifest_path": state_root.join("service.json").to_string_lossy()
                }),
            );
        }
    }
    // JSON is a YAML 1.2 subset. Emitting it avoids a second parser while still
    // giving the Gateway a standards-compliant, deterministic YAML document.
    serde_json::to_string_pretty(&document)
        .map(|value| format!("{value}\n"))
        .map_err(|_| "Gateway configuration could not be encoded".into())
}

fn insert_optional(target: &mut Value, key: &str, value: Option<&str>) {
    if let (Some(object), Some(value)) = (target.as_object_mut(), value) {
        object.insert(key.into(), json!(value));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[derive(Clone)]
    struct FakeChildState {
        exited: Arc<Mutex<bool>>,
        terminated: Arc<Mutex<bool>>,
    }
    struct FakeChild {
        state: FakeChildState,
    }
    impl OwnedGatewayChild for FakeChild {
        fn id(&self) -> u32 {
            4242
        }
        fn has_exited(&mut self) -> Result<bool, ()> {
            Ok(*self.state.exited.lock().unwrap())
        }
        fn terminate(&mut self, _timeout: Duration) -> Result<(), ()> {
            *self.state.terminated.lock().unwrap() = true;
            *self.state.exited.lock().unwrap() = true;
            Ok(())
        }
    }

    #[derive(Default)]
    struct LaunchCapture {
        arguments: Vec<String>,
        environment: Vec<(String, String)>,
    }
    struct FakeLauncher {
        capture: Arc<Mutex<LaunchCapture>>,
        state: FakeChildState,
        verify_error: Option<String>,
        readiness_error: Option<String>,
    }
    impl GatewayProcessLauncher for FakeLauncher {
        fn verify(&self, _binary: &OsStr) -> Result<(), String> {
            self.verify_error.clone().map_or(Ok(()), Err)
        }
        fn spawn(
            &self,
            _binary: &OsStr,
            arguments: &[OsString],
            environment: &[(OsString, OsString)],
        ) -> Result<Box<dyn OwnedGatewayChild>, ()> {
            let mut capture = self.capture.lock().unwrap();
            capture.arguments = arguments
                .iter()
                .map(|value| value.to_string_lossy().into_owned())
                .collect();
            capture.environment = environment
                .iter()
                .map(|(key, value)| {
                    (
                        key.to_string_lossy().into_owned(),
                        value.to_string_lossy().into_owned(),
                    )
                })
                .collect();
            Ok(Box::new(FakeChild {
                state: self.state.clone(),
            }))
        }
        fn wait_until_ready(
            &self,
            _config: &GatewayRuntimeConfig,
            _child: &mut dyn OwnedGatewayChild,
        ) -> Result<(), String> {
            self.readiness_error.clone().map_or(Ok(()), Err)
        }
    }

    fn fake_launcher(capture: Arc<Mutex<LaunchCapture>>, state: FakeChildState) -> FakeLauncher {
        FakeLauncher {
            capture,
            state,
            verify_error: None,
            readiness_error: None,
        }
    }

    struct FakeCredentials;
    impl CredentialResolver for FakeCredentials {
        fn load(&self, reference: &str) -> Result<String, String> {
            match reference {
                "tunnel.ref" => Ok("secret-tunnel-value".into()),
                "key.ref" => Ok("secret-api-value".into()),
                LOCAL_GATEWAY_CREDENTIAL_REF => Ok("local-bearer-token-0123456789".into()),
                _ => Err("not found".into()),
            }
        }
        fn store(&self, _reference: &str, _secret: &str) -> Result<(), String> {
            Ok(())
        }
    }

    fn openai_config() -> GatewayRuntimeConfig {
        GatewayRuntimeConfig {
            version: 1,
            desired_running: false,
            server: crate::models::GatewayServerConfig {
                host: "127.0.0.1".into(),
                port: 9090,
            },
            tunnel: GatewayTunnelConfig::OpenAiManaged {
                profile_id: "openai-gui".into(),
                tunnel_id_credential_ref: "tunnel.ref".into(),
                runtime_key_credential_ref: "key.ref".into(),
                credential_ttl_ms: 300_000,
                auto_install: false,
            },
        }
    }

    #[test]
    fn parses_gateway_versions_for_the_runtime_compatibility_gate() {
        assert_eq!(
            parse_gateway_version(b"pi-maestro-gateway 0.31.3\n"),
            Some(([0, 31, 3], false))
        );
        assert_eq!(
            parse_gateway_version(b"v0.32.0-beta.1"),
            Some(([0, 32, 0], true))
        );
        assert_eq!(parse_gateway_version(b"unknown"), None);
        assert!(!gateway_version_is_supported(([0, 31, 2], false)));
        assert!(!gateway_version_is_supported(([0, 31, 3], true)));
        assert!(gateway_version_is_supported(([0, 31, 3], false)));
        assert!(gateway_version_is_supported(([0, 32, 0], true)));
    }

    #[test]
    fn constructor_removes_a_stale_runtime_credential_file() {
        let temp = tempfile::tempdir().unwrap();
        let paths = RuntimePaths::new(temp.path()).unwrap();
        std::fs::write(&paths.gateway, "stale-bearer").unwrap();
        let child_state = FakeChildState {
            exited: Arc::new(Mutex::new(false)),
            terminated: Arc::new(Mutex::new(false)),
        };
        let supervisor = GatewayRuntimeSupervisor::with_dependencies(
            temp.path().to_path_buf(),
            Box::new(fake_launcher(
                Arc::new(Mutex::new(LaunchCapture::default())),
                child_state,
            )),
            Box::new(FakeCredentials),
        )
        .unwrap();

        assert!(!supervisor.paths.gateway.exists());
    }

    #[test]
    fn validates_bounded_runtime_fields() {
        let mut config = openai_config();
        assert!(validate_config(&config).is_ok());
        config.server.port = 0;
        assert!(validate_config(&config).is_err());
        config.server.port = 9090;
        if let GatewayTunnelConfig::OpenAiManaged {
            credential_ttl_ms, ..
        } = &mut config.tunnel
        {
            *credential_ttl_ms = 59_999;
        }
        assert!(validate_config(&config).is_err());
    }

    #[test]
    fn generated_openai_yaml_is_url_less_and_uses_managed_forward() {
        let yaml = generate_gateway_yaml(&openai_config()).unwrap();
        assert!(yaml.contains("managed-forward"));
        assert!(yaml.contains("gateway.host.status"));
        assert!(yaml.contains("\"mode\": \"bearer\""));
        assert!(!yaml.contains("fabric.control.device.list"));
        assert!(yaml.contains("\"http\": {"));
        assert!(yaml.contains("\"enabled\": true"));
        assert!(!yaml.contains("public_url"));
        assert!(!yaml.contains("server_url"));
        assert!(!yaml.contains("tunnel.ref"));
        assert!(!yaml.contains("key.ref"));
    }

    #[test]
    fn secrets_only_reach_child_environment() {
        let temp = tempfile::tempdir().unwrap();
        let capture = Arc::new(Mutex::new(LaunchCapture::default()));
        let child_state = FakeChildState {
            exited: Arc::new(Mutex::new(false)),
            terminated: Arc::new(Mutex::new(false)),
        };
        let mut supervisor = GatewayRuntimeSupervisor::with_dependencies(
            temp.path().to_path_buf(),
            Box::new(fake_launcher(capture.clone(), child_state)),
            Box::new(FakeCredentials),
        )
        .unwrap();
        supervisor.save_config(openai_config()).unwrap();
        assert!(!supervisor.paths.gateway.exists());
        let state = supervisor.start().unwrap();
        assert_eq!(state.status, GatewayRuntimeStatus::Running);
        assert_eq!(state.pid, Some(4242));
        assert_eq!(state.http_url, "http://127.0.0.1:9090/mcp");
        assert!(Path::new(&state.config_path).is_absolute());
        let yaml = std::fs::read_to_string(&supervisor.paths.gateway).unwrap();
        let persisted = std::fs::read_to_string(&supervisor.paths.runtime).unwrap();
        let state_json = serde_json::to_string(&state).unwrap();
        for secret in ["secret-tunnel-value", "secret-api-value"] {
            assert!(!yaml.contains(secret));
            assert!(!persisted.contains(secret));
            assert!(!state_json.contains(secret));
        }
        let capture = capture.lock().unwrap();
        assert!(capture
            .environment
            .contains(&(TUNNEL_ID_ENV.into(), "secret-tunnel-value".into())));
        assert!(capture
            .environment
            .contains(&(API_KEY_ENV.into(), "secret-api-value".into())));
        assert!(!capture.arguments.join(" ").contains("secret-"));
    }

    #[test]
    fn dependency_failure_does_not_write_the_runtime_credential_file() {
        let temp = tempfile::tempdir().unwrap();
        let child_state = FakeChildState {
            exited: Arc::new(Mutex::new(false)),
            terminated: Arc::new(Mutex::new(false)),
        };
        let mut launcher =
            fake_launcher(Arc::new(Mutex::new(LaunchCapture::default())), child_state);
        launcher.verify_error = Some("pi-maestro-gateway is required".into());
        let mut supervisor = GatewayRuntimeSupervisor::with_dependencies(
            temp.path().to_path_buf(),
            Box::new(launcher),
            Box::new(FakeCredentials),
        )
        .unwrap();

        assert_eq!(
            supervisor.start().unwrap_err(),
            "pi-maestro-gateway is required"
        );
        assert!(!supervisor.paths.gateway.exists());
        assert_eq!(supervisor.state().status, GatewayRuntimeStatus::Failed);
    }

    #[test]
    fn readiness_failure_terminates_the_child_and_removes_credentials() {
        let temp = tempfile::tempdir().unwrap();
        let child_state = FakeChildState {
            exited: Arc::new(Mutex::new(false)),
            terminated: Arc::new(Mutex::new(false)),
        };
        let terminated = child_state.terminated.clone();
        let mut launcher =
            fake_launcher(Arc::new(Mutex::new(LaunchCapture::default())), child_state);
        launcher.readiness_error =
            Some("Gateway did not become ready before the startup deadline".into());
        let mut supervisor = GatewayRuntimeSupervisor::with_dependencies(
            temp.path().to_path_buf(),
            Box::new(launcher),
            Box::new(FakeCredentials),
        )
        .unwrap();

        assert!(supervisor.start().is_err());
        assert!(*terminated.lock().unwrap());
        assert!(!supervisor.paths.gateway.exists());
        assert_eq!(supervisor.state().status, GatewayRuntimeStatus::Failed);
    }

    #[test]
    fn dto_serialization_is_camel_case() {
        let value = serde_json::to_value(openai_config()).unwrap();
        let tunnel = value.get("tunnel").and_then(Value::as_object).unwrap();
        assert_eq!(tunnel.get("kind"), Some(&json!("openai-managed")));
        assert!(tunnel.contains_key("profileId"));
        assert!(tunnel.contains_key("tunnelIdCredentialRef"));
        assert!(tunnel.contains_key("runtimeKeyCredentialRef"));
        assert!(tunnel.contains_key("credentialTtlMs"));
        assert!(!tunnel.contains_key("profile_id"));
    }

    #[test]
    fn desired_state_persists_and_transitions_stop_cleanly() {
        let temp = tempfile::tempdir().unwrap();
        let capture = Arc::new(Mutex::new(LaunchCapture::default()));
        let child_state = FakeChildState {
            exited: Arc::new(Mutex::new(false)),
            terminated: Arc::new(Mutex::new(false)),
        };
        let terminated = child_state.terminated.clone();
        let mut supervisor = GatewayRuntimeSupervisor::with_dependencies(
            temp.path().to_path_buf(),
            Box::new(fake_launcher(capture, child_state)),
            Box::new(FakeCredentials),
        )
        .unwrap();
        assert_eq!(supervisor.state().status, GatewayRuntimeStatus::Stopped);
        assert_eq!(
            supervisor.start().unwrap().status,
            GatewayRuntimeStatus::Running
        );
        let persisted = load_persisted(&supervisor.paths.runtime).unwrap();
        assert!(persisted.desired_running);
        assert!(supervisor.paths.gateway.exists());
        let stopped = supervisor.stop().unwrap();
        assert_eq!(stopped.status, GatewayRuntimeStatus::Stopped);
        assert!(!supervisor.paths.gateway.exists());
        assert!(!stopped.desired_running);
        assert!(*terminated.lock().unwrap());
        assert!(
            !load_persisted(&supervisor.paths.runtime)
                .unwrap()
                .desired_running
        );
    }

    #[test]
    fn unexpected_exit_transitions_to_failed_without_process_details() {
        let temp = tempfile::tempdir().unwrap();
        let child_state = FakeChildState {
            exited: Arc::new(Mutex::new(false)),
            terminated: Arc::new(Mutex::new(false)),
        };
        let exited = child_state.exited.clone();
        let mut supervisor = GatewayRuntimeSupervisor::with_dependencies(
            temp.path().to_path_buf(),
            Box::new(fake_launcher(
                Arc::new(Mutex::new(LaunchCapture::default())),
                child_state,
            )),
            Box::new(FakeCredentials),
        )
        .unwrap();
        supervisor.start().unwrap();
        *exited.lock().unwrap() = true;
        let state = supervisor.state();
        assert_eq!(state.status, GatewayRuntimeStatus::Failed);
        assert!(state.desired_running);
        assert_eq!(state.pid, None);
        assert_eq!(
            state.error.as_deref(),
            Some("Gateway process exited unexpectedly")
        );
    }
}
