mod bridge_supervisor;
mod commands;
mod credentials;
mod desktop_shell;
mod models;
mod state;
mod tray;

use tauri::Manager;
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| desktop_shell::show(app)))
        .manage(desktop_shell::DesktopShellState::default())
        .setup(|app| {
            let bundled = app.path().resource_dir()?.join("bridge").join("dist").join("worker.js");
            let development = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("bridge").join("dist").join("worker.js");
            let bridge_script = if bundled.exists() { bundled } else { development };
            app.manage(state::AppState::new(Some(bridge_script)));
            tray::setup(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::get_desktop_state, commands::bridge_handshake, commands::bridge_action, commands::cancel_operation])
        .build(tauri::generate_context!())
        .expect("error while building Maestro Fabric GUI");
    app.run(|handle,event| match event {
        tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::CloseRequested { api, .. }, .. } if label == desktop_shell::MAIN_WINDOW && handle.state::<desktop_shell::DesktopShellState>().should_hide() => { api.prevent_close(); if let Some(window)=handle.get_webview_window(desktop_shell::MAIN_WINDOW){let _=window.hide();} },
        tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => handle.state::<desktop_shell::DesktopShellState>().request_exit(),
        _ => {}
    });
}
