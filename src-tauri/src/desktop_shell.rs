use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager};
pub const MAIN_WINDOW: &str = "main";
#[derive(Default)] pub struct DesktopShellState { exiting: AtomicBool }
impl DesktopShellState { pub fn request_exit(&self){ self.exiting.store(true,Ordering::SeqCst); } pub fn should_hide(&self)->bool{ !self.exiting.load(Ordering::SeqCst) } }
pub fn show(app:&AppHandle){ if let Some(window)=app.get_webview_window(MAIN_WINDOW){ let _=window.unminimize(); let _=window.show(); let _=window.set_focus(); } }
#[cfg(test)] mod tests { use super::*; #[test] fn close_hides_until_exit(){let state=DesktopShellState::default();assert!(state.should_hide());state.request_exit();assert!(!state.should_hide());} }
