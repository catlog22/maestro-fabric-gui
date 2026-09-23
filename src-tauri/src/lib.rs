mod bridge_supervisor;
mod commands;
mod credentials;
mod desktop_shell;
mod gateway_runtime;
mod models;
mod state;
mod tray;

use std::sync::Arc;
use tauri::Manager;

pub(crate) fn stop_owned_gateway_runtime(app: &tauri::AppHandle) {
    let state = app.state::<Arc<state::AppState>>();
    let Ok(mut runtime) = state.gateway_runtime.lock() else {
        return;
    };
    let _ = runtime.shutdown_owned();
}

fn resolve_bridge_script(
    resource_dir: &std::path::Path,
    manifest_dir: &std::path::Path,
) -> std::path::PathBuf {
    let bundled = resource_dir.join("bridge").join("dist").join("worker.js");
    if bundled.exists() {
        bundled
    } else {
        manifest_dir
            .join("..")
            .join("bridge")
            .join("dist")
            .join("worker.js")
    }
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            desktop_shell::show(app)
        }))
        .manage(desktop_shell::DesktopShellState::default())
        .setup(|app| {
            let resource_dir = app.path().resource_dir()?;
            let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
            let bridge_script = resolve_bridge_script(&resource_dir, manifest_dir);
            let app_data_dir = app.path().app_data_dir()?;
            let state = state::AppState::new(Some(bridge_script), app_data_dir)
                .map_err(std::io::Error::other)?;
            app.manage(state);
            tray::setup(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_desktop_state,
            commands::bridge_handshake,
            commands::bridge_action,
            commands::get_gateway_runtime_config,
            commands::save_gateway_runtime_config,
            commands::get_gateway_runtime_state,
            commands::start_gateway_runtime,
            commands::stop_gateway_runtime,
            commands::restart_gateway_runtime,
            commands::import_gateway_credentials,
            commands::delete_gateway_credential,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Maestro Fabric GUI");
    app.run(|handle, event| match event {
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::CloseRequested { api, .. },
            ..
        } if label == desktop_shell::MAIN_WINDOW
            && handle
                .state::<desktop_shell::DesktopShellState>()
                .should_hide() =>
        {
            api.prevent_close();
            if let Some(window) = handle.get_webview_window(desktop_shell::MAIN_WINDOW) {
                let _ = window.hide();
            }
        }
        tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
            handle
                .state::<desktop_shell::DesktopShellState>()
                .request_exit();
            stop_owned_gateway_runtime(handle);
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_bridge_path_matches_the_declared_resource_target() {
        let resources = tempfile::tempdir().unwrap();
        let bundled = resources
            .path()
            .join("bridge")
            .join("dist")
            .join("worker.js");
        std::fs::create_dir_all(bundled.parent().unwrap()).unwrap();
        std::fs::write(&bundled, "bridge").unwrap();

        assert_eq!(
            resolve_bridge_script(resources.path(), std::path::Path::new("manifest")),
            bundled
        );
    }
}
