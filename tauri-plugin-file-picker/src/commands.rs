use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::FilePickerExt;
use crate::Result;

#[command]
pub(crate) async fn ping<R: Runtime>(
    app: AppHandle<R>,
    payload: PingRequest,
) -> Result<PingResponse> {
    app.file_picker().ping(payload)
}

#[command]
pub(crate) async fn read_content_uri<R: Runtime>(
    app: AppHandle<R>,
    payload: ReadContentUriRequest,
) -> Result<ReadContentUriResponse> {
    app.file_picker().read_content_uri(payload)
}
