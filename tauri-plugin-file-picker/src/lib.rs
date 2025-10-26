use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod commands;
mod error;
mod models;

pub use error::{Error, Result};

#[cfg(desktop)]
use desktop::FilePicker;
#[cfg(mobile)]
use mobile::FilePicker;

/// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`] to access the file-picker APIs.
pub trait FilePickerExt<R: Runtime> {
    fn file_picker(&self) -> &FilePicker<R>;
}

impl<R: Runtime, T: Manager<R>> crate::FilePickerExt<R> for T {
    fn file_picker(&self) -> &FilePicker<R> {
        self.state::<FilePicker<R>>().inner()
    }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("file-picker")
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::read_content_uri
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let file_picker = mobile::init(app, api)?;
            #[cfg(desktop)]
            let file_picker = desktop::init(app, api)?;
            app.manage(file_picker);
            Ok(())
        })
        .build()
}
