use serde::Serialize;
use std::{fs, io, path::{Path, PathBuf}};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileEntryKind {
    File,
    Folder,
}

#[derive(Serialize)]
pub struct FileTreeEntry {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub kind: FileEntryKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileTreeEntry>>,
}

pub fn ensure_projects_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .resolve("projects", BaseDirectory::AppData)
        .map_err(|e| e.to_string())?;

    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    Ok(dir)
}

pub fn normalize_entry_name(raw: &str) -> Result<String, String> {
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

pub fn is_cross_device_error(err: &io::Error) -> bool {
    match err.raw_os_error() {
        Some(code) if code == 17 || code == 18 => true,
        _ => false,
    }
}

pub fn copy_entry_recursive(source: &Path, destination: &Path) -> Result<(), String> {
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

pub fn read_directory_entries(dir: &Path) -> Result<Vec<FileTreeEntry>, String> {
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
