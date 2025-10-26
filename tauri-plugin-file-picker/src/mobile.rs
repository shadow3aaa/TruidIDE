use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_file_picker);

// initializes the Kotlin or Swift plugin classes
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<FilePicker<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin("com.plugin.filepicker", "ExamplePlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_file_picker)?;
    Ok(FilePicker(handle))
}

/// Access to the file-picker APIs.
pub struct FilePicker<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> FilePicker<R> {
    pub fn ping(&self, payload: PingRequest) -> crate::Result<PingResponse> {
        self.0
            .run_mobile_plugin("ping", payload)
            .map_err(Into::into)
    }

    pub fn read_content_uri(
        &self,
        payload: ReadContentUriRequest,
    ) -> crate::Result<ReadContentUriResponse> {
        self.0
            .run_mobile_plugin("readContentUri", payload)
            .map_err(Into::into)
    }
}
