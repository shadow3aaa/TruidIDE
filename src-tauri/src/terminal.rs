use once_cell::sync::OnceCell;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
#[cfg(target_os = "android")]
use std::fs::{self, File};
use std::io::prelude::*;
#[cfg(target_os = "android")]
use std::path::Path;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;
#[cfg(target_os = "android")]
use tauri::path::BaseDirectory;
use tauri::{Emitter, Manager};
#[cfg(target_os = "android")]
use xz2::bufread::XzDecoder;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

static SESSIONS: OnceCell<
    Mutex<
        HashMap<
            String,
            (
                Box<dyn portable_pty::MasterPty + Send>,
                Box<dyn Write + Send>,
                Box<dyn portable_pty::Child + Send>,
            ),
        >,
    >,
> = OnceCell::new();
static SESSION_COUNTER: AtomicU64 = AtomicU64::new(1);

fn sessions_map() -> &'static Mutex<
    HashMap<
        String,
        (
            Box<dyn portable_pty::MasterPty + Send>,
            Box<dyn Write + Send>,
            Box<dyn portable_pty::Child + Send>,
        ),
    >,
> {
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn generate_session_id() -> String {
    let n = SESSION_COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("s{}", n)
}

#[cfg(target_os = "android")]
fn decompress_tar_xz(src: &Path, dest: &Path) -> io::Result<()> {
    let file = File::open(src)?;
    let buf_reader = BufReader::new(file);
    let xz_decoder = XzDecoder::new(buf_reader);
    let mut archive = tar::Archive::new(xz_decoder);
    archive.unpack(dest)?;

    Ok(())
}

#[cfg(target_os = "android")]
fn prepare_proot_env(app: tauri::AppHandle) -> Result<String, String> {
    // Locate files/proot in app data
    let appdata_base = app
        .path()
        .resolve("files/proot", BaseDirectory::AppData)
        .map_err(|e| e.to_string())?;

    if !appdata_base.exists() {
        return Err(format!("应用私有目录中未找到 proot 目录：{}，请确保应用已在启动时解压 assets/proot 到 files/proot", appdata_base.to_string_lossy()));
    }

    let dest = appdata_base;

    let rootfs_dir = dest.join("rootfs");
    if !rootfs_dir.exists() {
        // If a compressed rootfs archive exists, try to extract it
        let compressed = dest.join("rootfs.tar.xz");
        if !compressed.exists() {
            return Err(format!("rootfs 未解压到 {}，请确保已将 rootfs 解压到该目录或将 rootfs.tar.xz 放在此目录以启用自动解压", rootfs_dir.to_string_lossy()));
        }

        if !rootfs_dir.exists() {
            decompress_tar_xz(&compressed, &rootfs_dir)
                .map_err(|e| format!("解压 rootfs 失败: {e:?}"))?;
        }

        // set executable perms for proot binaries on unix
        let proot_path = dest.join("proot/bin/proot");
        let loader_path = dest.join("proot/libexec/proot/loader");
        let loader32_path = dest.join("proot/libexec/proot/loader32");
        let files_to_make_executable = [&proot_path, &loader_path, &loader32_path];
        #[cfg(unix)]
        {
            for file_path in &files_to_make_executable {
                if !file_path.exists() {
                    return Err(format!(
                        "必需的文件未找到: {}，请确保 assets 中包含 proot 及其所有组件",
                        file_path.to_string_lossy()
                    ));
                }

                let mut perms = fs::metadata(file_path)
                    .map_err(|e| format!("无法获取元数据 ({}): {e}", file_path.to_string_lossy()))?
                    .permissions();

                let current_mode = perms.mode();
                let new_mode = current_mode | 0o111;

                if current_mode != new_mode {
                    perms.set_mode(new_mode);
                    fs::set_permissions(file_path, perms).map_err(|e| {
                        format!("无法设置可执行权限 ({}): {e}", file_path.to_string_lossy())
                    })?;
                }
            }
        }

        if !rootfs_dir.exists() {
            return Err(format!(
                "解压完成后仍未找到 rootfs 目录: {}",
                rootfs_dir.to_string_lossy()
            ));
        }
    }

    Ok(dest.to_string_lossy().into_owned())
}

#[cfg(target_os = "android")]
fn start_proot_session_internal(
    app: tauri::AppHandle,
    cwd_in_rootfs: Option<String>,
) -> Result<String, String> {
    let prepared = prepare_proot_env(app.clone())?;

    let prepared_path = PathBuf::from(prepared);
    let proot = prepared_path.join("proot/bin/proot");

    let rootfs_dir = prepared_path.join("rootfs");
    // Extracted archive may contain arch-specific subdir
    #[cfg(target_arch = "aarch64")]
    let rootfs_dir = rootfs_dir.join("archlinux-aarch64");
    #[cfg(target_arch = "arm")]
    let rootfs_dir = rootfs_dir.join("archlinux-armv7l");
    #[cfg(target_arch = "x86_64")]
    let rootfs_dir = rootfs_dir.join("archlinux-x86_64");
    #[cfg(target_arch = "x86")]
    let rootfs_dir = rootfs_dir.join("archlinux-x86");

    if !rootfs_dir.exists() {
        return Err("rootfs 未解压".into());
    }

    let mut cmd = CommandBuilder::new(proot.to_string_lossy().as_ref());

    let tmp_dir = prepared_path.join("proot_tmp");
    let _ = fs::create_dir(&tmp_dir);
    cmd.env("PROOT_TMP_DIR", tmp_dir.to_string_lossy().as_ref());

    cmd.arg(format!("--rootfs={}", rootfs_dir.to_string_lossy()));

    if let Some(wd) = cwd_in_rootfs {
        let guest_path = PathBuf::from("/mnt/project");
        let full_guest_path = rootfs_dir.join(guest_path.strip_prefix("/").unwrap());
        let _ = fs::create_dir_all(&full_guest_path);
        cmd.arg(format!("--bind={}:{}", wd, guest_path.to_string_lossy()));
        cmd.arg(format!("--cwd={}", guest_path.to_string_lossy()));
    }

    cmd.args(&[
        "--root-id",
        "--kill-on-exit",
        "--link2symlink",
        "--bind=/dev",
        "--bind=/proc",
        "--bind=/sys",
        "--bind=/dev/urandom:/dev/random",
        "--bind=/proc/self/fd:/dev/fd",
        "--bind=/proc/self/fd/0:/dev/stdin",
        "--bind=/proc/self/fd/1:/dev/stdout",
        "--bind=/proc/self/fd/2:/dev/stderr",
        "/bin/bash",
        "--login",
    ]);

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("无法打开 pty: {e}"))?;
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn proot 失败: {e}"))?;
    let master = pair.master;

    let reader = master
        .try_clone_reader()
        .map_err(|e| format!("无法克隆 reader: {e}"))?;
    let writer = master
        .take_writer()
        .map_err(|e| format!("无法获取 writer: {e}"))?;

    let session_id = generate_session_id();

    // spawn reader thread
    {
        let handle = app.clone();
        let sid = session_id.clone();
        thread::spawn(move || {
            let mut reader = reader;
            let mut buf = [0u8; 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let s = String::from_utf8_lossy(&buf[..n]).to_string();
                        if let Some(window) = handle.get_webview_window("main") {
                            let _ = window.emit(&format!("terminal-output-{}", sid), s.clone());
                        }
                    }
                    Err(_) => break,
                }
            }
        });
    }

    // store session
    {
        let mut map = sessions_map().lock().map_err(|e| format!("锁错误: {e}"))?;
        map.insert(session_id.clone(), (master, writer, child));
    }

    Ok(session_id)
}

#[tauri::command]
pub fn start_terminal_session(app: tauri::AppHandle, cwd: String) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        match start_proot_session_internal(app.clone(), Some(cwd.clone())) {
            Ok(sid) => return Ok(sid),
            Err(e) => return Err(format!("proot 启动失败: {e}")),
        }
    }

    let cwd_path = PathBuf::from(&cwd);
    if !cwd_path.exists() || !cwd_path.is_dir() {
        return Err("工作目录不存在或不是目录".into());
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("无法打开 pty: {e}"))?;

    let mut cmd = CommandBuilder::new_default_prog();
    cmd.cwd(cwd_path);

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn 失败: {e}"))?;

    let master = pair.master;

    let reader = master
        .try_clone_reader()
        .map_err(|e| format!("无法克隆 reader: {e}"))?;
    let writer = master
        .take_writer()
        .map_err(|e| format!("无法获取 writer: {e}"))?;

    let session_id = generate_session_id();

    {
        let handle = app.clone();
        let sid = session_id.clone();
        thread::spawn(move || {
            let mut reader = reader;
            let mut buf = [0u8; 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let s = String::from_utf8_lossy(&buf[..n]).to_string();
                        if let Some(window) = handle.get_webview_window("main") {
                            let _ = window.emit(&format!("terminal-output-{}", sid), s.clone());
                        }
                    }
                    Err(_) => break,
                }
            }
        });
    }

    {
        let mut map = sessions_map().lock().map_err(|e| format!("锁错误: {e}"))?;
        map.insert(session_id.clone(), (master, writer, child));
    }

    Ok(session_id)
}

#[tauri::command]
pub fn send_terminal_input(
    _app: tauri::AppHandle,
    session_id: String,
    input: String,
) -> Result<(), String> {
    let mut map = sessions_map().lock().map_err(|e| format!("锁错误: {e}"))?;
    if let Some((_master, writer, _child)) = map.get_mut(&session_id) {
        writer
            .write_all(input.as_bytes())
            .map_err(|e| format!("写入 pty 失败: {e}"))?;
        Ok(())
    } else {
        Err("会话未找到".into())
    }
}

#[tauri::command]
pub fn resize_terminal(
    _app: tauri::AppHandle,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    let mut map = sessions_map().lock().map_err(|e| format!("锁错误: {e}"))?;
    if let Some((master, _writer, _)) = map.get_mut(&session_id) {
        master
            .resize(PtySize {
                rows: rows as u16,
                cols: cols as u16,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("调整大小失败: {e}"))?;
        Ok(())
    } else {
        Err("会话未找到".into())
    }
}

#[tauri::command]
pub fn stop_terminal_session(_app: tauri::AppHandle, session_id: String) -> Result<(), String> {
    let mut map = sessions_map().lock().map_err(|e| format!("锁错误: {e}"))?;
    if let Some((_master, _writer, mut child)) = map.remove(&session_id) {
        let _ = child.kill();
        let _ = child.wait();
        Ok(())
    } else {
        Err("会话未找到".into())
    }
}
