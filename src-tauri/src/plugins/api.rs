use serde::Serialize;
use serde_json::Value;
#[cfg(target_os = "android")]
use tauri::path::BaseDirectory;
use tauri::AppHandle;
#[cfg(target_os = "android")]
use tauri::Manager;

use super::lsp_host::resolve_plugin_directories;
use super::{
    DiscoveredPlugin, LspSendPayload, LspSessionIdArgs, PluginHost, PluginKind, PluginLocation,
    PluginManifest, StartLspSessionArgs, StartLspSessionResponse,
};
use crate::fs_utils::copy_entry_recursive;
use std::fs;
use std::fs::File;
use std::io;
use std::path::{Component, Path, PathBuf};
use tempfile::TempDir;
use zip::ZipArchive;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSummary {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub tags: Vec<String>,
    pub location: PluginLocationRepr,
    pub kind: PluginKindSummary,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PluginLocationRepr {
    BuiltIn,
    User,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum PluginKindSummary {
    Lsp {
        #[serde(rename = "languageIds")]
        language_ids: Vec<String>,
        #[serde(
            skip_serializing_if = "Option::is_none",
            rename = "initializationOptions"
        )]
        initialization_options: Option<Value>,
    },
}

impl From<PluginLocation> for PluginLocationRepr {
    fn from(value: PluginLocation) -> Self {
        match value {
            PluginLocation::BuiltIn => PluginLocationRepr::BuiltIn,
            PluginLocation::User => PluginLocationRepr::User,
        }
    }
}

fn summarize_plugin(plugin: &DiscoveredPlugin) -> PluginSummary {
    let kind = match &plugin.manifest.kind {
        PluginKind::Lsp(manifest) => PluginKindSummary::Lsp {
            language_ids: manifest.language_ids.clone(),
            initialization_options: manifest.initialization_options.clone(),
        },
    };

    PluginSummary {
        id: plugin.manifest.id.clone(),
        name: plugin.manifest.name.clone(),
        version: plugin.manifest.version.clone(),
        description: plugin.manifest.description.clone(),
        author: plugin.manifest.author.clone(),
        enabled: plugin.manifest.enabled,
        tags: plugin.manifest.tags.clone(),
        location: plugin.location.into(),
        kind,
    }
}

#[tauri::command]
pub async fn list_plugins(app: AppHandle) -> Result<Vec<PluginSummary>, String> {
    let host = PluginHost::obtain(&app)?;
    Ok(host
        .list_plugins()
        .await
        .into_iter()
        .map(|plugin| summarize_plugin(&plugin))
        .collect())
}

#[tauri::command]
pub async fn refresh_plugins(app: AppHandle) -> Result<Vec<PluginSummary>, String> {
    let host = PluginHost::obtain(&app)?;
    host.reload_registry().await?;
    let plugins = host.list_plugins().await;
    Ok(plugins
        .into_iter()
        .map(|plugin| summarize_plugin(&plugin))
        .collect())
}

#[tauri::command]
pub async fn start_lsp_session(
    app: AppHandle,
    args: StartLspSessionArgs,
) -> Result<StartLspSessionResponse, String> {
    let host = PluginHost::obtain(&app)?;
    host.start_lsp_session(args).await
}

#[tauri::command]
pub async fn send_lsp_payload(app: AppHandle, payload: LspSendPayload) -> Result<(), String> {
    let host = PluginHost::obtain(&app)?;
    host.send_payload(payload).await
}

#[tauri::command]
pub async fn stop_lsp_session(app: AppHandle, args: LspSessionIdArgs) -> Result<(), String> {
    let host = PluginHost::obtain(&app)?;
    host.stop_session(args).await
}

#[tauri::command]
pub async fn import_plugin(app: AppHandle, source_path: String) -> Result<PluginSummary, String> {
    if source_path.is_empty() {
        return Err("请选择要导入的插件包".into());
    }

    // 处理路径：Android 平台可能返回 content:// URI
    let path = resolve_source_path(&app, &source_path).await?;

    if !path.exists() {
        return Err(format!("源路径不存在: {}", source_path))?;
    }

    let host = PluginHost::obtain(&app)?;
    let directories = resolve_plugin_directories(&app)?;
    let user_root = directories
        .user
        .first()
        .cloned()
        .ok_or_else(|| "无法定位用户插件目录".to_string())?;

    fs::create_dir_all(&user_root).map_err(|e| format!("创建插件目录失败: {e}"))?;

    let mut temp_holder: Option<TempDir> = None;
    let plugin_root = if path.is_file() {
        if !matches!(
            path.extension().and_then(|ext| ext.to_str()),
            Some(ext) if ext.eq_ignore_ascii_case("zip")
        ) {
            return Err("仅支持导入 zip 插件包或包含清单的目录".into());
        }

        let temp_dir = tempfile::tempdir().map_err(|e| format!("创建临时目录失败: {e}"))?;
        extract_zip_archive(&path, temp_dir.path())?;
        temp_holder = Some(temp_dir);
        let extracted_root = temp_holder.as_ref().unwrap().path();
        locate_manifest_root(extracted_root)?
    } else if path.is_dir() {
        locate_manifest_root(&path)?
    } else {
        return Err("不支持的插件来源".into());
    };

    let manifest_path = plugin_root.join("truid-plugin.json");
    let manifest_data =
        fs::read_to_string(&manifest_path).map_err(|e| format!("读取插件清单失败: {e}"))?;
    let manifest: PluginManifest =
        serde_json::from_str(&manifest_data).map_err(|e| format!("解析插件清单失败: {e}"))?;

    let existing = host
        .list_plugins()
        .await
        .into_iter()
        .find(|plugin| plugin.manifest.id == manifest.id);
    if let Some(plugin) = existing {
        if plugin.location == PluginLocation::User {
            return Err(format!("插件 {} 已导入，请先卸载或更换 ID", manifest.id));
        } else {
            return Err(format!(
                "插件 {} 与内置插件冲突，请修改清单中的 id",
                manifest.id
            ));
        }
    }

    let target_dir = user_root.join(&manifest.id);
    if target_dir.exists() {
        return Err(format!("目标目录已存在: {}", target_dir.to_string_lossy()));
    }

    copy_entry_recursive(&plugin_root, &target_dir)?;

    drop(temp_holder);

    host.reload_registry().await?;
    let plugin = host
        .list_plugins()
        .await
        .into_iter()
        .find(|plugin| plugin.manifest.id == manifest.id)
        .ok_or_else(|| "导入成功但未能在索引中找到插件".to_string())?;

    Ok(summarize_plugin(&plugin))
}

#[tauri::command]
pub async fn remove_plugin(
    app: AppHandle,
    plugin_id: String,
) -> Result<Vec<PluginSummary>, String> {
    if plugin_id.trim().is_empty() {
        return Err("插件标识不能为空".into());
    }

    let host = PluginHost::obtain(&app)?;
    let directories = resolve_plugin_directories(&app)?;
    if directories.user.is_empty() {
        return Err("无法定位用户插件目录".into());
    }

    let plugin = host
        .list_plugins()
        .await
        .into_iter()
        .find(|plugin| plugin.manifest.id == plugin_id)
        .ok_or_else(|| format!("未找到插件 {plugin_id}"))?;

    if plugin.location != PluginLocation::User {
        return Err("仅支持删除用户安装的插件".into());
    }

    fs::remove_dir_all(&plugin.root_dir).map_err(|e| format!("删除插件目录失败: {e}"))?;

    host.reload_registry().await?;

    let summaries = host
        .list_plugins()
        .await
        .into_iter()
        .map(|plugin| summarize_plugin(&plugin))
        .collect();
    Ok(summaries)
}

/// 解析源路径,在 Android 上处理 Content URI
#[cfg(target_os = "android")]
async fn resolve_source_path(app: &AppHandle, source_path: &str) -> Result<PathBuf, String> {
    // 检查是否是 Content URI
    if source_path.starts_with("content://") {
        use tauri_plugin_file_picker::FilePickerExt;
        use tauri_plugin_file_picker::ReadContentUriRequest;

        // 使用缓存目录
        let cache_dir = app
            .path()
            .resolve("plugin_import_temp", BaseDirectory::Cache)
            .map_err(|e| format!("无法获取缓存目录: {e}"))?;

        // 确保缓存目录存在
        fs::create_dir_all(&cache_dir).map_err(|e| format!("无法创建缓存目录: {e}"))?;

        // 生成临时文件路径
        let temp_file = cache_dir.join("imported_plugin.zip");

        // 使用自定义插件读取 Content URI
        let response = app
            .file_picker()
            .read_content_uri(ReadContentUriRequest {
                content_uri: source_path.to_string(),
                target_path: Some(temp_file.to_string_lossy().to_string()),
            })
            .map_err(|e| format!("无法读取 Content URI ({}): {}", source_path, e))?;

        if !response.success {
            return Err(format!("读取 Content URI 失败: {}", source_path));
        }

        if let Some(path) = response.path {
            Ok(PathBuf::from(path))
        } else {
            Err("插件未返回文件路径".to_string())
        }
    } else {
        Ok(PathBuf::from(source_path))
    }
}

#[cfg(not(target_os = "android"))]
async fn resolve_source_path(_app: &AppHandle, source_path: &str) -> Result<PathBuf, String> {
    Ok(PathBuf::from(source_path))
}

fn extract_zip_archive(zip_path: &Path, destination: &Path) -> Result<(), String> {
    let file = File::open(zip_path).map_err(|e| format!("无法读取压缩包: {e}"))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("解析压缩包失败: {e}"))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("读取压缩包内容失败: {e}"))?;
        if let Some(mode) = entry.unix_mode() {
            const S_IFMT: u32 = 0o170000;
            const S_IFLNK: u32 = 0o120000;
            if (mode & S_IFMT) == S_IFLNK {
                return Err("插件包中不允许包含符号链接".into());
            }
        }

        let relative = sanitize_archive_path(entry.name())?;
        if relative.as_os_str().is_empty() {
            continue;
        }

        let out_path = destination.join(&relative);
        if entry.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| format!("创建目录失败: {e}"))?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
            }
            let mut output = File::create(&out_path).map_err(|e| format!("写入文件失败: {e}"))?;
            io::copy(&mut entry, &mut output).map_err(|e| format!("写入文件失败: {e}"))?;
        }
    }

    Ok(())
}

fn sanitize_archive_path(raw: &str) -> Result<PathBuf, String> {
    let mut result = PathBuf::new();
    for component in Path::new(raw).components() {
        match component {
            Component::Normal(part) => result.push(part),
            Component::RootDir | Component::Prefix(_) => {
                return Err("插件包中包含非法路径".into());
            }
            Component::ParentDir => {
                return Err("插件包中的路径存在越级访问".into());
            }
            Component::CurDir => {}
        }
    }
    Ok(result)
}

fn locate_manifest_root(path: &Path) -> Result<PathBuf, String> {
    if !path.is_dir() {
        return Err("插件包结构非法".into());
    }

    let candidate = path.join("truid-plugin.json");
    if candidate.is_file() {
        return Ok(path.to_path_buf());
    }

    let mut dirs = Vec::new();
    let entries = fs::read_dir(path).map_err(|e| format!("读取插件包内容失败: {e}"))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("读取插件包内容失败: {e}"))?;
        if entry
            .file_type()
            .map_err(|e| format!("读取文件类型失败: {e}"))?
            .is_dir()
        {
            dirs.push(entry.path());
        }
    }

    for dir in dirs {
        if let Ok(found) = locate_manifest_root(&dir) {
            return Ok(found);
        }
    }

    Err("未在插件包中找到 truid-plugin.json".into())
}
