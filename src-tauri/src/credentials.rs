use keyring::Entry;
use serde_json::Value;

const SERVICE: &str = "maestro-fabric-gui";

pub fn valid_reference(reference: &str) -> bool {
    !reference.is_empty() && reference.len() <= 128 && reference.chars().all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '_' | ':' | '-'))
}

pub fn load(reference: &str) -> Result<String, String> {
    if !valid_reference(reference) { return Err("Credential reference is invalid".into()); }
    let entry = Entry::new(SERVICE, reference).map_err(|_| "OS credential store is unavailable".to_string())?;
    entry.get_password().map_err(|_| "Credential is unavailable".to_string())
}

pub fn inject_credential(mut payload: Value) -> Result<Value, String> {
    let Some(object) = payload.as_object_mut() else { return Ok(payload); };
    let Some(reference) = object.get("credentialRef").and_then(Value::as_str).map(str::to_owned) else { return Ok(payload); };
    let secret = load(&reference)?;
    object.insert("token".into(), Value::String(secret));
    object.remove("credentialRef");
    Ok(payload)
}

#[cfg(test)]
mod tests {
    use super::valid_reference;
    #[test]
    fn accepts_safe_reference() { assert!(valid_reference("gateway.remote.eu")); }
    #[test]
    fn rejects_path_like_reference() { assert!(!valid_reference("../token")); }
}
