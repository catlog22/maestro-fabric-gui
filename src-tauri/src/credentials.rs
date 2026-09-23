use keyring::Entry;
use serde_json::Value;
use std::{collections::BTreeMap, path::Path};

const SERVICE: &str = "maestro-fabric-gui";
pub const LOCAL_GATEWAY_CREDENTIAL_REF: &str = "gateway.runtime.local";

pub fn valid_reference(reference: &str) -> bool {
    !reference.is_empty()
        && reference.len() <= 128
        && reference
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '_' | ':' | '-'))
}

pub fn load(reference: &str) -> Result<String, String> {
    if !valid_reference(reference) {
        return Err("Credential reference is invalid".into());
    }
    let entry = Entry::new(SERVICE, reference)
        .map_err(|_| "OS credential store is unavailable".to_string())?;
    entry
        .get_password()
        .map_err(|_| "Credential is unavailable".to_string())
}

pub fn set(reference: &str, secret: &str) -> Result<(), String> {
    if !valid_reference(reference) {
        return Err("Credential reference is invalid".into());
    }
    if secret.is_empty() || secret.len() > 16_384 {
        return Err("Credential value is invalid".into());
    }
    let entry = Entry::new(SERVICE, reference)
        .map_err(|_| "OS credential store is unavailable".to_string())?;
    entry
        .set_password(secret)
        .map_err(|_| "Credential could not be saved".to_string())
}

pub fn delete(reference: &str) -> Result<(), String> {
    if !valid_reference(reference) {
        return Err("Credential reference is invalid".into());
    }
    let entry = Entry::new(SERVICE, reference)
        .map_err(|_| "OS credential store is unavailable".to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Credential could not be deleted".into()),
    }
}

pub fn import_openai_env_file(
    path: &str,
    tunnel_id_reference: &str,
    runtime_key_reference: &str,
    delete_after_import: bool,
) -> Result<(), String> {
    if !valid_reference(tunnel_id_reference) || !valid_reference(runtime_key_reference) {
        return Err("Credential reference is invalid".into());
    }
    if tunnel_id_reference == runtime_key_reference {
        return Err("OpenAI credential references must be distinct".into());
    }
    if tunnel_id_reference == LOCAL_GATEWAY_CREDENTIAL_REF
        || runtime_key_reference == LOCAL_GATEWAY_CREDENTIAL_REF
    {
        return Err("The local Gateway credential reference is reserved".into());
    }
    let path = Path::new(path);
    if !path.is_absolute() {
        return Err("Credential import path must be absolute".into());
    }
    let metadata =
        std::fs::metadata(path).map_err(|_| "Credential import file is unavailable".to_string())?;
    if !metadata.is_file() || metadata.len() > 32 * 1024 {
        return Err("Credential import file is invalid".into());
    }
    let content = std::fs::read_to_string(path)
        .map_err(|_| "Credential import file could not be read".to_string())?;
    let values = parse_openai_env(&content)?;
    let tunnel_id = values
        .get("CONTROL_PLANE_TUNNEL_ID")
        .expect("validated key");
    let runtime_key = values.get("CONTROL_PLANE_API_KEY").expect("validated key");
    set(tunnel_id_reference, tunnel_id)?;
    if let Err(error) = set(runtime_key_reference, runtime_key) {
        let _ = delete(tunnel_id_reference);
        return Err(error);
    }
    if delete_after_import {
        std::fs::remove_file(path).map_err(|_| {
            "Credentials were stored, but the import file could not be deleted".to_string()
        })?;
    }
    Ok(())
}

fn parse_openai_env(content: &str) -> Result<BTreeMap<String, String>, String> {
    let mut values = BTreeMap::new();
    for line in content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let Some((key, value)) = line.split_once('=') else {
            return Err("Credential import file is invalid".into());
        };
        if key != "CONTROL_PLANE_TUNNEL_ID" && key != "CONTROL_PLANE_API_KEY" {
            return Err("Credential import file contains an unsupported key".into());
        }
        let value = value.trim();
        if value.is_empty()
            || value.len() > 16_384
            || values.insert(key.to_string(), value.to_string()).is_some()
        {
            return Err("Credential import file is invalid".into());
        }
    }
    if values.len() != 2 {
        return Err("Credential import file must contain both OpenAI tunnel credentials".into());
    }
    let tunnel_id = values
        .get("CONTROL_PLANE_TUNNEL_ID")
        .expect("validated key");
    if tunnel_id.len() != 39
        || !tunnel_id.starts_with("tunnel_")
        || !tunnel_id[7..]
            .bytes()
            .all(|value| value.is_ascii_hexdigit() && !value.is_ascii_uppercase())
    {
        return Err("Tunnel ID is invalid".into());
    }
    Ok(values)
}

pub fn inject_credential(mut payload: Value) -> Result<Value, String> {
    let Some(object) = payload.as_object_mut() else {
        return Ok(payload);
    };
    let Some(reference) = object
        .get("credentialRef")
        .and_then(Value::as_str)
        .map(str::to_owned)
    else {
        return Ok(payload);
    };
    let secret = load(&reference)?;
    object.insert("token".into(), Value::String(secret));
    object.remove("credentialRef");
    Ok(payload)
}

#[cfg(test)]
mod tests {
    use super::{parse_openai_env, valid_reference};
    #[test]
    fn accepts_safe_reference() {
        assert!(valid_reference("gateway.remote.eu"));
    }
    #[test]
    fn rejects_path_like_reference() {
        assert!(!valid_reference("../token"));
    }
    #[test]
    fn parses_exact_openai_environment_without_exposing_values() {
        let values = parse_openai_env("CONTROL_PLANE_TUNNEL_ID=tunnel_0123456789abcdef0123456789abcdef\nCONTROL_PLANE_API_KEY=secret-value\n").unwrap();
        assert_eq!(values.len(), 2);
        assert!(parse_openai_env("CONTROL_PLANE_API_KEY=secret-value\n").is_err());
        assert!(parse_openai_env("OTHER=value\nCONTROL_PLANE_TUNNEL_ID=tunnel_0123456789abcdef0123456789abcdef\nCONTROL_PLANE_API_KEY=secret-value\n").is_err());
    }
}
