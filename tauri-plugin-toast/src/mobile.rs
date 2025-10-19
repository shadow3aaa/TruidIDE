use anyhow::Result;
use serde::de::DeserializeOwned;
use tauri::{plugin::{PluginApi, PluginHandle}, AppHandle, Runtime};

#[cfg(target_os = "android")]
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> Result<ToastPlugin<R>> {
    let handle = api.register_android_plugin("com.plugin.toast", "ToastPlugin")?;
    Ok(ToastPlugin(handle))
}

#[cfg(target_os = "ios")]
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> Result<ToastPlugin<R>> {
    let handle = api.register_ios_plugin(init_plugin_toast)?;
    Ok(ToastPlugin(handle))
}

pub struct ToastPlugin<R: Runtime>(pub PluginHandle<R>);