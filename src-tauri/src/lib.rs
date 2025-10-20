mod fs_utils;

use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::Write,
    path::PathBuf,
    time::UNIX_EPOCH,
};
// refer to tauri items with fully-qualified paths to avoid shadowing `Result`.

use crate::fs_utils::{
    FileTreeEntry,
    copy_entry_recursive,
    ensure_projects_dir,
    is_cross_device_error,
    normalize_entry_name,
    read_directory_entries,
};

#[derive(Serialize)]
pub struct ProjectEntry {
    name: String,
    path: String,
    last_modified_secs: Option<u64>,
}

#[tauri::command]
fn list_projects(app: tauri::AppHandle) -> Result<Vec<ProjectEntry>, String> {
    let root = ensure_projects_dir(&app)?;

    let mut projects = Vec::new();

    let entries = fs::read_dir(&root).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                // Skip entries that fail to read while keeping the list responsive.
                continue;
            }
        };

        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };

        let last_modified_secs = entry
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs());

        projects.push(ProjectEntry {
            name: name.to_string(),
            path: path.to_string_lossy().into_owned(),
            last_modified_secs,
        });
    }

    projects.sort_by(|a, b| b.last_modified_secs.cmp(&a.last_modified_secs));

    Ok(projects)
}


#[derive(Deserialize)]
pub struct CreateProjectRequest {
    template_id: String,
    name: String,
}

#[derive(Serialize)]
pub struct CreateProjectResponse {
    project: ProjectEntry,
}

#[tauri::command]
fn create_project(
    app: tauri::AppHandle,
    request: CreateProjectRequest,
) -> Result<CreateProjectResponse, String> {
    if request.template_id != "basic-web" {
        return Err("暂不支持该模板".into());
    }

    let trimmed = request.name.trim();
    if trimmed.is_empty() {
        return Err("项目名称不能为空".into());
    }

    let invalid_chars = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'];
    if trimmed.chars().any(|ch| invalid_chars.contains(&ch)) {
        return Err("项目名称包含不允许的字符".into());
    }

    let root = ensure_projects_dir(&app)?;

    let mut folder_name = trimmed.to_string();
    let mut candidate = root.join(&folder_name);
    let mut counter = 1;
    while candidate.exists() {
        folder_name = format!("{}-{counter}", trimmed);
        candidate = root.join(&folder_name);
        counter += 1;
    }

    fs::create_dir_all(&candidate).map_err(|e| e.to_string())?;

    let index_path = candidate.join("index.html");
    let mut file = File::create(&index_path).map_err(|e| e.to_string())?;
    // Use external template files to keep this source small. Paths are relative to this file's directory at compile time.
    const TEMPLATE: &str = include_str!("templates/basic_web_index.html");
    file.write_all(TEMPLATE.as_bytes()).map_err(|e| e.to_string())?;

    // Also write the helper JS file into the project so the template can import it.
    let js_path = candidate.join("truid_api.js");
    let mut js_file = File::create(&js_path).map_err(|e| e.to_string())?;
    const TRUID_API_JS: &str = include_str!("templates/truid_api.js");
    js_file
        .write_all(TRUID_API_JS.as_bytes())
        .map_err(|e| e.to_string())?;

    let now = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();

    let project = ProjectEntry {
        name: folder_name,
        path: candidate.to_string_lossy().into_owned(),
        last_modified_secs: Some(now),
    };

    Ok(CreateProjectResponse { project })
}



#[tauri::command]
fn list_project_tree(
    app: tauri::AppHandle,
    project_path: String,
) -> Result<Vec<FileTreeEntry>, String> {
    let projects_root = ensure_projects_dir(&app)?
        .canonicalize()
        .map_err(|e| e.to_string())?;

    let requested_path = PathBuf::from(project_path);
    let canonical_requested = requested_path
        .canonicalize()
        .map_err(|e| format!("无法访问项目目录: {e}"))?;

    if !canonical_requested.starts_with(&projects_root) {
        return Err("项目路径不在受信目录内".into());
    }

    if !canonical_requested.is_dir() {
        return Err("目标路径不是有效的项目目录".into());
    }

    read_directory_entries(&canonical_requested)
}

#[tauri::command]
fn read_project_file(app: tauri::AppHandle, file_path: String) -> Result<String, String> {
    let projects_root = ensure_projects_dir(&app)?
        .canonicalize()
        .map_err(|e| e.to_string())?;

    let requested_path = PathBuf::from(file_path);
    let canonical_requested = requested_path
        .canonicalize()
        .map_err(|e| format!("无法读取文件: {e}"))?;

    if !canonical_requested.starts_with(&projects_root) {
        return Err("文件路径不在受信目录内".into());
    }

    if !canonical_requested.is_file() {
        return Err("目标不是有效的文件".into());
    }

    let data = fs::read(&canonical_requested).map_err(|e| format!("读取文件失败: {e}"))?;

    Ok(String::from_utf8_lossy(&data).into_owned())
}

#[tauri::command]
fn save_project_file(
    app: tauri::AppHandle,
    file_path: String,
    contents: String,
) -> Result<(), String> {
    let projects_root = ensure_projects_dir(&app)?
        .canonicalize()
        .map_err(|e| e.to_string())?;

    let requested_path = PathBuf::from(&file_path);
    let canonical_requested = requested_path
        .canonicalize()
        .map_err(|e| format!("无法保存文件: {e}"))?;

    if !canonical_requested.starts_with(&projects_root) {
        return Err("文件路径不在受信目录内".into());
    }

    if canonical_requested.is_dir() {
        return Err("目标是目录，无法写入".into());
    }

    fs::write(&canonical_requested, contents).map_err(|e| format!("保存文件失败: {e}"))?;

    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum NewEntryKind {
    File,
    Folder,
}

#[tauri::command]
fn create_project_entry(
    app: tauri::AppHandle,
    parent_path: String,
    name: String,
    kind: NewEntryKind,
) -> Result<(), String> {
    let projects_root = ensure_projects_dir(&app)?
        .canonicalize()
        .map_err(|e| e.to_string())?;

    let parent = PathBuf::from(parent_path);
    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| format!("无法访问目标目录: {e}"))?;

    if !canonical_parent.starts_with(&projects_root) {
        return Err("目标路径不在受信目录内".into());
    }

    if !canonical_parent.is_dir() {
        return Err("目标并不是有效的目录".into());
    }

    let normalized_name = normalize_entry_name(&name)?;

    let target_path = canonical_parent.join(&normalized_name);
    if target_path.exists() {
        return Err("同名文件或目录已存在".into());
    }

    match kind {
        NewEntryKind::Folder => {
            fs::create_dir(&target_path).map_err(|e| format!("创建文件夹失败: {e}"))?;
        }
        NewEntryKind::File => {
            File::create(&target_path).map_err(|e| format!("创建文件失败: {e}"))?;
        }
    }

    Ok(())
}

#[tauri::command]
fn delete_project_entry(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let projects_root = ensure_projects_dir(&app)?
        .canonicalize()
        .map_err(|e| e.to_string())?;

    let entry_path = PathBuf::from(&path);
    let canonical_entry = entry_path
        .canonicalize()
        .map_err(|e| format!("无法删除目标: {e}"))?;

    if !canonical_entry.starts_with(&projects_root) {
        return Err("目标路径不在受信目录内".into());
    }

    if canonical_entry == projects_root {
        return Err("无法删除项目根目录".into());
    }

    if canonical_entry.is_dir() {
        fs::remove_dir_all(&canonical_entry).map_err(|e| format!("删除目录失败: {e}"))?;
    } else if canonical_entry.is_file() {
        fs::remove_file(&canonical_entry).map_err(|e| format!("删除文件失败: {e}"))?;
    } else {
        return Err("目标既不是文件也不是目录".into());
    }

    Ok(())
}

#[tauri::command]
fn rename_project_entry(
    app: tauri::AppHandle,
    path: String,
    new_name: String,
) -> Result<(), String> {
    let projects_root = ensure_projects_dir(&app)?
        .canonicalize()
        .map_err(|e| e.to_string())?;

    let entry_path = PathBuf::from(&path);
    let canonical_entry = entry_path
        .canonicalize()
        .map_err(|e| format!("无法重命名目标: {e}"))?;

    if !canonical_entry.starts_with(&projects_root) {
        return Err("目标路径不在受信目录内".into());
    }

    let normalized_name = normalize_entry_name(&new_name)?;

    let parent = canonical_entry
        .parent()
        .ok_or_else(|| "无法确定父目录".to_string())?;

    let destination = parent.join(&normalized_name);

    if destination == canonical_entry {
        return Ok(());
    }

    if destination.exists() {
        return Err("同名文件或目录已存在".into());
    }

    fs::rename(&canonical_entry, &destination).map_err(|e| format!("重命名失败: {e}"))?;

    Ok(())
}

#[tauri::command]
fn copy_project_entry(
    app: tauri::AppHandle,
    source_path: String,
    target_directory_path: String,
) -> Result<(), String> {
    let projects_root = ensure_projects_dir(&app)?
        .canonicalize()
        .map_err(|e| e.to_string())?;

    let source = PathBuf::from(&source_path);
    let canonical_source = source
        .canonicalize()
        .map_err(|e| format!("无法复制源路径: {e}"))?;

    if !canonical_source.starts_with(&projects_root) {
        return Err("源路径不在受信目录内".into());
    }

    let target_dir = PathBuf::from(&target_directory_path);
    let canonical_target_dir = target_dir
        .canonicalize()
        .map_err(|e| format!("无法访问目标目录: {e}"))?;

    if !canonical_target_dir.starts_with(&projects_root) {
        return Err("目标路径不在受信目录内".into());
    }

    if !canonical_target_dir.is_dir() {
        return Err("目标路径并不是有效的目录".into());
    }

    let Some(name) = canonical_source.file_name().and_then(|n| n.to_str()) else {
        return Err("无法确定条目名称".into());
    };

    let destination = canonical_target_dir.join(name);

    if destination.exists() {
        return Err("目标目录已存在同名条目".into());
    }

    if canonical_source.is_dir() && destination.starts_with(&canonical_source) {
        return Err("无法将文件夹复制到其自身或子目录中".into());
    }

    if let Err(err) = copy_entry_recursive(&canonical_source, &destination) {
        if destination.exists() {
            let _ = if destination.is_dir() {
                fs::remove_dir_all(&destination)
            } else {
                fs::remove_file(&destination)
            };
        }
        return Err(err);
    }

    Ok(())
}

#[tauri::command]
fn move_project_entry(
    app: tauri::AppHandle,
    source_path: String,
    target_directory_path: String,
) -> Result<(), String> {
    let projects_root = ensure_projects_dir(&app)?
        .canonicalize()
        .map_err(|e| e.to_string())?;

    let source = PathBuf::from(&source_path);
    let canonical_source = source
        .canonicalize()
        .map_err(|e| format!("无法移动源路径: {e}"))?;

    if !canonical_source.starts_with(&projects_root) {
        return Err("源路径不在受信目录内".into());
    }

    let target_dir = PathBuf::from(&target_directory_path);
    let canonical_target_dir = target_dir
        .canonicalize()
        .map_err(|e| format!("无法访问目标目录: {e}"))?;

    if !canonical_target_dir.starts_with(&projects_root) {
        return Err("目标路径不在受信目录内".into());
    }

    if !canonical_target_dir.is_dir() {
        return Err("目标路径并不是有效的目录".into());
    }

    let Some(name) = canonical_source.file_name().and_then(|n| n.to_str()) else {
        return Err("无法确定条目名称".into());
    };

    let destination = canonical_target_dir.join(name);

    if destination == canonical_source {
        return Ok(());
    }

    if destination.exists() {
        return Err("目标目录已存在同名条目".into());
    }

    if canonical_source.is_dir() && destination.starts_with(&canonical_source) {
        return Err("无法将文件夹移动到其自身或子目录中".into());
    }

    match fs::rename(&canonical_source, &destination) {
        Ok(()) => Ok(()),
        Err(err) => {
            if !is_cross_device_error(&err) {
                return Err(format!("移动失败: {err}"));
            }

            // 跨设备移动，降级为复制 + 删除
            if let Err(copy_err) = copy_entry_recursive(&canonical_source, &destination) {
                if destination.exists() {
                    let _ = if destination.is_dir() {
                        fs::remove_dir_all(&destination)
                    } else {
                        fs::remove_file(&destination)
                    };
                }
                return Err(copy_err);
            }

            if canonical_source.is_dir() {
                fs::remove_dir_all(&canonical_source)
                    .map_err(|e| format!("删除源目录失败: {e}"))?;
            } else {
                fs::remove_file(&canonical_source).map_err(|e| format!("删除源文件失败: {e}"))?;
            }

            Ok(())
        }
    }
}

#[tauri::command]
fn resolve_preview_entry(app: tauri::AppHandle, project_path: String) -> Result<String, String> {
    let projects_root = ensure_projects_dir(&app)?
        .canonicalize()
        .map_err(|e| e.to_string())?;

    let requested_path = PathBuf::from(project_path);
    let canonical_requested = requested_path
        .canonicalize()
        .map_err(|e| format!("无法访问项目目录: {e}"))?;

    if !canonical_requested.starts_with(&projects_root) {
        return Err("项目路径不在受信目录内".into());
    }

    if !canonical_requested.is_dir() {
        return Err("目标路径不是有效的项目目录".into());
    }

    let preferred_candidates = [
        "dist/index.html",
        "build/index.html",
        "public/index.html",
        "index.html",
        "index.htm",
    ];

    for candidate in preferred_candidates {
        let candidate_path = canonical_requested.join(candidate);
        if candidate_path.is_file() {
            return Ok(candidate_path.to_string_lossy().into_owned());
        }
    }

    let mut stack = vec![canonical_requested];
    while let Some(dir) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();

            if path.is_dir() {
                if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
                    let lowered = name.to_ascii_lowercase();
                    if matches!(
                        lowered.as_str(),
                        "node_modules" | ".git" | "dist" | "build" | "target" | ".vite" | ".next"
                    ) {
                        continue;
                    }
                }
                stack.push(path);
                continue;
            }

            if let Some(ext) = path.extension().and_then(|ext| ext.to_str()) {
                let lowered_ext = ext.to_ascii_lowercase();
                if lowered_ext == "html" || lowered_ext == "htm" {
                    return Ok(path.to_string_lossy().into_owned());
                }
            }
        }
    }

    Err("未找到可用的预览入口文件，请在项目目录中提供 index.html".into())
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_toast::init())
        .invoke_handler(tauri::generate_handler![
            list_projects,
            list_project_tree,
            read_project_file,
            save_project_file,
            create_project_entry,
            delete_project_entry,
            rename_project_entry,
            copy_project_entry,
            move_project_entry,
            resolve_preview_entry,
            create_project
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
