use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, Runtime,
};

mod mobile;
use mobile::ToastPlugin;

use serde::Serialize;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ToastPayload {
    text: String,
}

#[tauri::command]
fn toast<R: Runtime>(app: AppHandle<R>, text: String) -> Result<(), String> {
    let plugin = app.state::<ToastPlugin<R>>().inner();
    #[cfg(mobile)]
    {
        plugin
            .0
            .run_mobile_plugin::<()>("toast", ToastPayload { text })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("toast")
        .invoke_handler(tauri::generate_handler![toast])
        .setup(|app, api| {
            #[cfg(mobile)]
            {
                let toast_plugin = mobile::init(app, api).map_err(|e| e.to_string())?;
                app.manage(toast_plugin);
            }
            Ok(())
        })
        .build()
}
