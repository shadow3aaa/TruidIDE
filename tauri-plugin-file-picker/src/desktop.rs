use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<FilePicker<R>> {
    Ok(FilePicker(app.clone()))
}

/// Access to the file-picker APIs.
pub struct FilePicker<R: Runtime>(AppHandle<R>);

impl<R: Runtime> FilePicker<R> {
    pub fn ping(&self, payload: PingRequest) -> crate::Result<PingResponse> {
        Ok(PingResponse {
            value: payload.value,
        })
    }

    pub fn read_content_uri(
        &self,
        _payload: ReadContentUriRequest,
    ) -> crate::Result<ReadContentUriResponse> {
        // Desktop 平台不需要处理 Content URI
        Err(crate::Error::Custom(
            "Desktop platforms do not support Content URI".into(),
        ))
    }
}
