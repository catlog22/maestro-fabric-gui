use crate::desktop_shell;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};
const OPEN: &str = "tray.open";
const QUIT: &str = "tray.quit";
pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, OPEN, "Open Maestro Fabric GUI", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    TrayIconBuilder::with_id("maestro-fabric-gui")
        .tooltip("Maestro Fabric GUI")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            OPEN => desktop_shell::show(app),
            QUIT => {
                app.state::<desktop_shell::DesktopShellState>()
                    .request_exit();
                crate::stop_owned_gateway_runtime(app);
                app.exit(0)
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}
