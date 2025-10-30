use crate::fs_utils::{
    copy_entry_recursive, ensure_projects_dir, is_cross_device_error, normalize_entry_name,
    read_directory_entries, FileTreeEntry,
};
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[cfg(target_os = "android")]
use crate::android::proot::{resolve_guest_path, ProotEnv};

#[cfg(target_os = "android")]
fn host_path_to_guest(env: &ProotEnv, host_path: &Path) -> Option<String> {
    let relative = host_path.strip_prefix(&env.rootfs_dir).ok()?;
    let mut guest = PathBuf::from("/");
    if !relative.as_os_str().is_empty() {
        guest.push(relative);
    }
    Some(guest.to_string_lossy().replace('\\', "/"))
}

#[cfg(target_os = "android")]
fn convert_entries_to_guest(env: &ProotEnv, entries: &mut [FileTreeEntry]) {
    for entry in entries.iter_mut() {
        if let Some(guest_path) = host_path_to_guest(env, Path::new(&entry.path)) {
            entry.path = guest_path;
        }
        if let Some(children) = &mut entry.children {
            convert_entries_to_guest(env, children);
        }
    }
}

#[cfg(target_os = "android")]
fn resolve_android_path(
    app: &tauri::AppHandle,
    raw_path: &str,
    error_label: &str,
) -> Result<(PathBuf, bool), String> {
    let trimmed = raw_path.trim();
    if trimmed.starts_with('/') {
        let host = resolve_guest_path(app, trimmed)?;
        Ok((host, true))
    } else {
        let path = PathBuf::from(trimmed);
        let canonical = path
            .canonicalize()
            .map_err(|e| format!("{error_label}: {e}"))?;
        Ok((canonical, false))
    }
}

#[derive(Serialize)]
pub struct ProjectEntry {
    pub name: String,
    pub path: String,
    pub last_modified_secs: Option<u64>,
}

#[cfg(target_os = "android")]
#[tauri::command]
pub fn get_projects_root(app: tauri::AppHandle) -> Result<String, String> {
    let _ = crate::android::proot::prepare_proot_env(&app)?;
    Ok("/root".to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn get_projects_root(app: tauri::AppHandle) -> Result<String, String> {
    let root = ensure_projects_dir(&app)?;
    Ok(root.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn list_projects(app: tauri::AppHandle) -> Result<Vec<ProjectEntry>, String> {
    let root = ensure_projects_dir(&app)?;

    let mut projects = Vec::new();

    let entries = fs::read_dir(&root).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
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
    pub template_id: String,
    pub name: String,
}

#[derive(Serialize)]
pub struct CreateProjectResponse {
    pub project: ProjectEntry,
}

#[tauri::command]
pub fn create_project(
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

    // 创建 index.html
    let index_path = candidate.join("index.html");
    let mut file = File::create(&index_path).map_err(|e| e.to_string())?;
    const TEMPLATE: &str = include_str!("templates/basic_web_index.html");
    file.write_all(TEMPLATE.as_bytes())
        .map_err(|e| e.to_string())?;

    // 创建 style.css
    let css_path = candidate.join("style.css");
    let mut css_file = File::create(&css_path).map_err(|e| e.to_string())?;
    const STYLE_CSS: &str = include_str!("templates/style.css");
    css_file
        .write_all(STYLE_CSS.as_bytes())
        .map_err(|e| e.to_string())?;

    // 创建 script.js
    let js_path = candidate.join("script.js");
    let mut js_file = File::create(&js_path).map_err(|e| e.to_string())?;
    const SCRIPT_JS: &str = include_str!("templates/script.js");
    js_file
        .write_all(SCRIPT_JS.as_bytes())
        .map_err(|e| e.to_string())?;

    // 创建 server.py
    let server_path = candidate.join("server.py");
    let mut server_file = File::create(&server_path).map_err(|e| e.to_string())?;
    const SERVER_PY: &str = include_str!("templates/server.py");
    server_file
        .write_all(SERVER_PY.as_bytes())
        .map_err(|e| e.to_string())?;

    // 创建 README.md
    let readme_path = candidate.join("README.md");
    let mut readme_file = File::create(&readme_path).map_err(|e| e.to_string())?;
    const README_MD: &str = include_str!("templates/README.md");
    readme_file
        .write_all(README_MD.as_bytes())
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
pub fn list_project_tree(
    app: tauri::AppHandle,
    project_path: String,
) -> Result<Vec<FileTreeEntry>, String> {
    #[cfg(target_os = "android")]
    let projects_root = ensure_projects_dir(&app)?
        .canonicalize()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "android")]
    let (canonical_requested, is_guest_path) =
        resolve_android_path(&app, &project_path, "无法访问项目目录")?;

    #[cfg(not(target_os = "android"))]
    let canonical_requested = PathBuf::from(&project_path)
        .canonicalize()
        .map_err(|e| format!("无法访问项目目录: {e}"))?;

    #[cfg(target_os = "android")]
    {
        if !is_guest_path && !canonical_requested.starts_with(&projects_root) {
            return Err("项目路径不在受信目录内".into());
        }
    }

    if !canonical_requested.is_dir() {
        return Err("目标路径不是有效的项目目录".into());
    }

    let mut entries = read_directory_entries(&canonical_requested)?;

    #[cfg(target_os = "android")]
    {
        if is_guest_path {
            let env = crate::android::proot::prepare_proot_env(&app)?;
            convert_entries_to_guest(&env, &mut entries);
        }
    }

    Ok(entries)
}

#[tauri::command]
pub fn read_project_file(app: tauri::AppHandle, file_path: String) -> Result<String, String> {
    #[cfg(target_os = "android")]
    let projects_root = ensure_projects_dir(&app)?
        .canonicalize()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "android")]
    let (canonical_requested, is_guest_path) =
        resolve_android_path(&app, &file_path, "无法读取文件")?;

    #[cfg(not(target_os = "android"))]
    let canonical_requested = PathBuf::from(&file_path)
        .canonicalize()
        .map_err(|e| format!("无法读取文件: {e}"))?;

    #[cfg(target_os = "android")]
    {
        if !is_guest_path && !canonical_requested.starts_with(&projects_root) {
            return Err("文件路径不在受信目录内".into());
        }
    }

    if !canonical_requested.is_file() {
        return Err("目标不是有效的文件".into());
    }

    let data = fs::read(&canonical_requested).map_err(|e| format!("读取文件失败: {e}"))?;

    Ok(String::from_utf8_lossy(&data).into_owned())
}

#[tauri::command]
pub fn save_project_file(
    app: tauri::AppHandle,
    file_path: String,
    contents: String,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    let projects_root = ensure_projects_dir(&app)?
        .canonicalize()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "android")]
    let (canonical_requested, is_guest_path) =
        resolve_android_path(&app, &file_path, "无法保存文件")?;

    #[cfg(not(target_os = "android"))]
    let canonical_requested = PathBuf::from(&file_path)
        .canonicalize()
        .map_err(|e| format!("无法保存文件: {e}"))?;

    #[cfg(target_os = "android")]
    {
        if !is_guest_path && !canonical_requested.starts_with(&projects_root) {
            return Err("文件路径不在受信目录内".into());
        }
    }

    if canonical_requested.is_dir() {
        return Err("目标是目录，无法写入".into());
    }

    fs::write(&canonical_requested, contents).map_err(|e| format!("保存文件失败: {e}"))?;

    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NewEntryKind {
    File,
    Folder,
}

#[tauri::command]
pub fn create_project_entry(
    app: tauri::AppHandle,
    parent_path: String,
    name: String,
    kind: NewEntryKind,
) -> Result<(), String> {
    #[allow(unused)]
    let projects_root = ensure_projects_dir(&app)?
        .canonicalize()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "android")]
    let (canonical_parent, is_guest_path) =
        resolve_android_path(&app, &parent_path, "无法访问目标目录")?;

    #[cfg(not(target_os = "android"))]
    let canonical_parent = PathBuf::from(&parent_path)
        .canonicalize()
        .map_err(|e| format!("无法访问目标目录: {e}"))?;

    #[cfg(not(target_os = "android"))]
    {
        if !canonical_parent.starts_with(&projects_root) {
            return Err("目标路径不在受信目录内".into());
        }
    }

    #[cfg(target_os = "android")]
    {
        if !is_guest_path && !canonical_parent.starts_with(&projects_root) {
            return Err("目标路径不在受信目录内".into());
        }
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
pub fn delete_project_entry(app: tauri::AppHandle, path: String) -> Result<(), String> {
    #[cfg(not(target_os = "android"))]
    let projects_root = ensure_projects_dir(&app)?
        .canonicalize()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "android")]
    let projects_root = ensure_projects_dir(&app)?
        .canonicalize()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "android")]
    let (canonical_entry, is_guest_path) = resolve_android_path(&app, &path, "无法删除目标")?;

    #[cfg(not(target_os = "android"))]
    let canonical_entry = PathBuf::from(&path)
        .canonicalize()
        .map_err(|e| format!("无法删除目标: {e}"))?;

    #[cfg(target_os = "android")]
    {
        if !is_guest_path && !canonical_entry.starts_with(&projects_root) {
            return Err("目标路径不在受信目录内".into());
        }
    }

    #[cfg(not(target_os = "android"))]
    if canonical_entry.starts_with(&projects_root) && canonical_entry == projects_root {
        return Err("无法删除项目根目录".into());
    }

    #[cfg(target_os = "android")]
    if is_guest_path {
        return Err("目标路径不在受信目录内".into());
    } else if canonical_entry == projects_root {
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
pub fn rename_project_entry(
    app: tauri::AppHandle,
    path: String,
    new_name: String,
) -> Result<(), String> {
    #[cfg(not(target_os = "android"))]
    let projects_root = ensure_projects_dir(&app)?
        .canonicalize()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "android")]
    let projects_root = ensure_projects_dir(&app)?
        .canonicalize()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "android")]
    let (canonical_entry, is_guest_path) = resolve_android_path(&app, &path, "无法重命名目标")?;

    #[cfg(not(target_os = "android"))]
    let canonical_entry = PathBuf::from(&path)
        .canonicalize()
        .map_err(|e| format!("无法重命名目标: {e}"))?;

    #[cfg(not(target_os = "android"))]
    if !canonical_entry.starts_with(&projects_root) {
        return Err("目标路径不在受信目录内".into());
    }

    #[cfg(target_os = "android")]
    if !is_guest_path && !canonical_entry.starts_with(&projects_root) {
        return Err("目标路径不在受信目录内".into());
    } else if is_guest_path {
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
pub fn copy_project_entry(
    app: tauri::AppHandle,
    source_path: String,
    target_directory_path: String,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    let projects_root = ensure_projects_dir(&app)?
        .canonicalize()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "android")]
    let (canonical_source, source_is_guest) =
        resolve_android_path(&app, &source_path, "无法复制源路径")?;

    #[cfg(not(target_os = "android"))]
    let canonical_source = PathBuf::from(&source_path)
        .canonicalize()
        .map_err(|e| format!("无法复制源路径: {e}"))?;

    #[cfg(target_os = "android")]
    let (canonical_target_dir, target_is_guest) =
        resolve_android_path(&app, &target_directory_path, "无法访问目标目录")?;

    #[cfg(not(target_os = "android"))]
    let canonical_target_dir = PathBuf::from(&target_directory_path)
        .canonicalize()
        .map_err(|e| format!("无法访问目标目录: {e}"))?;

    #[cfg(target_os = "android")]
    if (!source_is_guest && !canonical_source.starts_with(&projects_root))
        || (!target_is_guest && !canonical_target_dir.starts_with(&projects_root))
    {
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
pub fn move_project_entry(
    app: tauri::AppHandle,
    source_path: String,
    target_directory_path: String,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    let projects_root = ensure_projects_dir(&app)?
        .canonicalize()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "android")]
    let (canonical_source, source_is_guest) =
        resolve_android_path(&app, &source_path, "无法移动源路径")?;

    #[cfg(not(target_os = "android"))]
    let canonical_source = PathBuf::from(&source_path)
        .canonicalize()
        .map_err(|e| format!("无法移动源路径: {e}"))?;

    #[cfg(target_os = "android")]
    let (canonical_target_dir, target_is_guest) =
        resolve_android_path(&app, &target_directory_path, "无法访问目标目录")?;

    #[cfg(not(target_os = "android"))]
    let canonical_target_dir = PathBuf::from(&target_directory_path)
        .canonicalize()
        .map_err(|e| format!("无法访问目标目录: {e}"))?;

    #[cfg(target_os = "android")]
    if (!source_is_guest && !canonical_source.starts_with(&projects_root))
        || (!target_is_guest && !canonical_target_dir.starts_with(&projects_root))
    {
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

            //跨设备，降级为复制+删除
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
pub fn resolve_preview_entry(
    app: tauri::AppHandle,
    project_path: String,
) -> Result<String, String> {
    #[allow(unused)]
    let projects_root = ensure_projects_dir(&app)?
        .canonicalize()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "android")]
    let (canonical_requested, is_guest_path) =
        resolve_android_path(&app, &project_path, "无法访问项目目录")?;

    #[cfg(not(target_os = "android"))]
    let canonical_requested = PathBuf::from(&project_path)
        .canonicalize()
        .map_err(|e| format!("无法访问项目目录: {e}"))?;

    #[cfg(not(target_os = "android"))]
    {
        if !canonical_requested.starts_with(&projects_root) {
            return Err("项目路径不在受信目录内".into());
        }
    }

    #[cfg(target_os = "android")]
    {
        if !is_guest_path && !canonical_requested.starts_with(&projects_root) {
            return Err("项目路径不在受信目录内".into());
        }
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
