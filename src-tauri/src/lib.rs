use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::{self, Write},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
use tauri::{path::BaseDirectory, Manager};

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

#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum FileEntryKind {
    File,
    Folder,
}

#[derive(Serialize)]
struct FileTreeEntry {
    name: String,
    path: String,
    #[serde(rename = "type")]
    kind: FileEntryKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    children: Option<Vec<FileTreeEntry>>,
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

fn normalize_entry_name(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("名称不能为空".into());
    }

    if trimmed == "." || trimmed == ".." {
        return Err("名称不可为 . 或 ..".into());
    }

    let invalid_chars = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'];
    if trimmed.chars().any(|ch| invalid_chars.contains(&ch)) {
        return Err("名称包含不允许的字符".into());
    }

    Ok(trimmed.to_string())
}

fn is_cross_device_error(err: &io::Error) -> bool {
    match err.raw_os_error() {
        Some(code) if code == 17 || code == 18 => true,
        _ => false,
    }
}

fn copy_entry_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    if source.is_dir() {
        fs::create_dir(destination).map_err(|e| format!("复制目录失败: {e}"))?;

        let entries = fs::read_dir(source).map_err(|e| format!("复制目录失败: {e}"))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("复制目录失败: {e}"))?;
            let file_type = entry
                .file_type()
                .map_err(|e| format!("复制目录失败: {e}"))?;

            if file_type.is_symlink() {
                continue;
            }

            let path = entry.path();
            let dest_path = destination.join(entry.file_name());

            if file_type.is_dir() {
                copy_entry_recursive(&path, &dest_path)?;
            } else if file_type.is_file() {
                fs::copy(&path, &dest_path).map_err(|e| format!("复制文件失败: {e}"))?;
            }
        }
    } else if source.is_file() {
        fs::copy(source, destination).map_err(|e| format!("复制文件失败: {e}"))?;
    } else {
        return Err("仅支持复制文件或文件夹".into());
    }

    Ok(())
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

fn read_directory_entries(dir: &Path) -> Result<Vec<FileTreeEntry>, String> {
    let mut entries = Vec::new();

    let read_dir = match fs::read_dir(dir) {
        Ok(read_dir) => read_dir,
        Err(err) => return Err(err.to_string()),
    };

    for entry in read_dir {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };

        let path = entry.path();
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };

        if file_type.is_symlink() {
            continue;
        }

        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };

        if file_type.is_dir() {
            let children = read_directory_entries(&path).unwrap_or_default();
            entries.push(FileTreeEntry {
                name: name.to_string(),
                path: path.to_string_lossy().into_owned(),
                kind: FileEntryKind::Folder,
                children: Some(children),
            });
        } else {
            entries.push(FileTreeEntry {
                name: name.to_string(),
                path: path.to_string_lossy().into_owned(),
                kind: FileEntryKind::File,
                children: None,
            });
        }
    }

    entries.sort_by(|a, b| {
        let a_is_dir = matches!(a.kind, FileEntryKind::Folder);
        let b_is_dir = matches!(b.kind, FileEntryKind::Folder);
        match b_is_dir.cmp(&a_is_dir) {
            std::cmp::Ordering::Equal => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
            other => other,
        }
    });

    Ok(entries)
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
    let html = r#"<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>TruidIDE Project</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.5; margin: 0; padding: 3rem; background: #f5f5f5; }
      main { max-width: 720px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 2rem; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.1); }
      h1 { margin-top: 0; font-size: 2rem; }
      p { color: #475569; }
      code { background: #e2e8f0; padding: 0.25rem 0.5rem; border-radius: 6px; }
    </style>
  </head>
  <body>
    <main>
      <h1>TruidIDE 基础 Web 模板</h1>
      <p>这是通过 TruidIDE 创建的示例项目。您可以在此目录中添加静态资源或接入框架构建流程。</p>
      <p><strong>预览提示：</strong> 将您的 web 构建产物放在该目录下，TruidIDE 将在安卓设备上提供预览和打包能力。</p>
      <p><strong>入口文件：</strong> <code>index.html</code></p>
    </main>
  </body>
</html>
"#;
    file.write_all(html.as_bytes()).map_err(|e| e.to_string())?;

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

fn ensure_projects_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .resolve("projects", BaseDirectory::AppData)
        .map_err(|e| e.to_string())?;

    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    Ok(dir)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
