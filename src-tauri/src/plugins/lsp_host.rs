use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use once_cell::sync::OnceCell;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command};
use tokio::sync::{mpsc, oneshot, RwLock};
use uuid::Uuid;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager};

use crate::plugins::registry::DiscoveredPlugin;
use crate::plugins::{LspPluginManifest, PluginDirectoriesConfig, PluginManifest, PluginRegistry};

#[cfg(target_os = "android")]
use crate::android::proot::prepare_proot_env;

const EVENT_LSP_MESSAGE: &str = "truidide://lsp/message";
const EVENT_LSP_STDERR: &str = "truidide://lsp/stderr";
const EVENT_LSP_EXIT: &str = "truidide://lsp/exit";
const EVENT_PLUGINS_UPDATED: &str = "truidide://plugins/updated";

#[derive(Clone)]
pub struct PluginHost {
    inner: Arc<PluginHostInner>,
}

struct PluginHostInner {
    app: AppHandle,
    registry: RwLock<PluginRegistry>,
    sessions: RwLock<HashMap<String, SessionRecord>>,
}

struct SessionRecord {
    pub plugin_id: String,
    pub language_id: String,
    pub workspace_path: PathBuf,
    write_tx: Option<mpsc::Sender<Vec<u8>>>,
    kill_tx: Option<oneshot::Sender<()>>,
}

static HOST: OnceCell<Arc<PluginHostInner>> = OnceCell::new();

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartLspSessionArgs {
    pub plugin_id: String,
    #[serde(default)]
    pub language_id: Option<String>,
    /// Absolute path to the workspace/project folder.
    pub workspace_path: String,
    #[serde(default)]
    pub client_capabilities: Option<Value>,
    #[serde(default)]
    pub workspace_folders: Option<Value>,
    #[serde(default)]
    pub initialization_options: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartLspSessionResponse {
    pub session_id: String,
    pub plugin_id: String,
    pub language_id: String,
    pub initialization_options: Option<Value>,
    pub client_capabilities: Option<Value>,
    pub workspace_folders: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path_mapping: Option<PathMapping>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PathMapping {
    /// Host workspace path (e.g., /data/user/0/.../files/projects/myapp)
    pub host_workspace: String,
    /// Guest workspace path inside proot (e.g., /mnt/workspace)
    pub guest_workspace: String,
    /// Host plugin path
    pub host_plugin: String,
    /// Guest plugin path inside proot (e.g., /opt/truidide/plugins/plugin-id)
    pub guest_plugin: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspSessionIdArgs {
    pub session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspSendPayload {
    pub session_id: String,
    pub payload: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LspMessagePayload {
    session_id: String,
    plugin_id: String,
    language_id: String,
    body: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LspStderrPayload {
    session_id: String,
    plugin_id: String,
    language_id: String,
    data: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LspExitPayload {
    session_id: String,
    plugin_id: String,
    language_id: String,
    status_code: Option<i32>,
    signal: Option<i32>,
}

impl PluginHost {
    pub fn obtain(app: &AppHandle) -> Result<Self, String> {
        let app_clone = app.clone();

        let inner = HOST.get_or_try_init::<_, String>(|| {
            let directories = resolve_plugin_directories(&app_clone)?;
            let mut registry = PluginRegistry::with_directories(directories);
            registry.refresh()?;

            Ok(Arc::new(PluginHostInner {
                app: app_clone.clone(),
                registry: RwLock::new(registry),
                sessions: RwLock::new(HashMap::new()),
            }))
        })?;

        Ok(Self {
            inner: inner.clone(),
        })
    }

    pub async fn reload_registry(&self) -> Result<Vec<PluginManifest>, String> {
        let directories = resolve_plugin_directories(&self.inner.app)?;
        {
            let mut registry = self.inner.registry.write().await;
            *registry = PluginRegistry::with_directories(directories);
            registry.refresh()?;
        }

        let manifests = {
            let registry = self.inner.registry.read().await;
            registry
                .all_plugins()
                .map(|(_, plugin)| plugin.manifest.clone())
                .collect::<Vec<_>>()
        };

        self.inner
            .app
            .emit(EVENT_PLUGINS_UPDATED, &manifests)
            .map_err(|e: tauri::Error| e.to_string())?;

        Ok(manifests)
    }

    pub async fn list_plugins(&self) -> Vec<DiscoveredPlugin> {
        let registry = self.inner.registry.read().await;
        registry
            .all_plugins()
            .map(|(_, plugin)| plugin.clone())
            .collect()
    }

    pub async fn start_lsp_session(
        &self,
        args: StartLspSessionArgs,
    ) -> Result<StartLspSessionResponse, String> {
        let (plugin, manifest) = {
            let registry = self.inner.registry.read().await;
            registry
                .get_lsp_manifest(&args.plugin_id)
                .map(|(plugin, manifest)| (plugin.clone(), manifest.clone()))
                .ok_or_else(|| format!("未找到插件 {}", args.plugin_id))?
        };

        if !plugin.manifest.enabled {
            return Err(format!("插件 {} 当前被禁用", plugin.manifest.id));
        }

        let language_id = args
            .language_id
            .or_else(|| manifest.language_ids.first().cloned())
            .ok_or_else(|| "插件未声明语言标识".to_string())?;

        let workspace_path = PathBuf::from(&args.workspace_path);
        if !workspace_path.exists() {
            return Err(format!(
                "工作区路径不存在: {}",
                workspace_path.to_string_lossy()
            ));
        }

        let initialization_options = args
            .initialization_options
            .clone()
            .or_else(|| manifest.initialization_options.clone());
        let client_capabilities = args.client_capabilities.clone();
        let workspace_folders = args.workspace_folders.clone();

        let session_id = Uuid::new_v4().to_string();

        let (mut child, path_mapping) = spawn_lsp_process(
            &self.inner.app,
            &plugin,
            &manifest,
            &workspace_path,
            &session_id,
        )
        .await?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "无法获取 LSP 进程的标准输入".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "无法获取 LSP 进程的标准输出".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "无法获取 LSP 进程的标准错误".to_string())?;

        let (write_tx, write_rx) = mpsc::channel::<Vec<u8>>(32);
        let (kill_tx, kill_rx) = oneshot::channel::<()>();

        let record = SessionRecord {
            plugin_id: plugin.manifest.id.clone(),
            language_id: language_id.clone(),
            workspace_path: workspace_path.clone(),
            write_tx: Some(write_tx.clone()),
            kill_tx: Some(kill_tx),
        };

        {
            let mut sessions = self.inner.sessions.write().await;
            sessions.insert(session_id.clone(), record);
        }

        let plugin_id = plugin.manifest.id.clone();
        #[cfg(debug_assertions)]
        eprintln!(
            "[truidide::lsp] session {} started (plugin: {} language: {})",
            session_id, plugin_id, language_id
        );

        self.spawn_writer_task(&session_id, stdin, write_rx);
        self.spawn_reader_task(&session_id, plugin_id.clone(), language_id.clone(), stdout);
        self.spawn_stderr_task(&session_id, plugin_id.clone(), language_id.clone(), stderr);
        self.spawn_wait_task(
            session_id.clone(),
            plugin_id.clone(),
            language_id.clone(),
            child,
            kill_rx,
        );

        Ok(StartLspSessionResponse {
            session_id,
            plugin_id,
            language_id,
            initialization_options,
            client_capabilities,
            workspace_folders,
            path_mapping,
        })
    }

    pub async fn send_payload(&self, args: LspSendPayload) -> Result<(), String> {
        let tx = {
            let sessions = self.inner.sessions.read().await;
            let Some(record) = sessions.get(&args.session_id) else {
                return Err(format!("找不到会话 {}", args.session_id));
            };

            let Some(write_tx) = record.write_tx.as_ref() else {
                return Err("会话正在关闭，无法发送消息".into());
            };

            write_tx.clone()
        };

        let payload =
            serde_json::to_vec(&args.payload).map_err(|e| format!("序列化 LSP 负载失败: {e}"))?;

        let mut framed = format!("Content-Length: {}\r\n\r\n", payload.len()).into_bytes();
        framed.extend_from_slice(&payload);
        #[cfg(debug_assertions)]
        eprintln!(
            "[truidide::lsp] <= (session {}) {}",
            args.session_id,
            describe_message(&args.payload)
        );

        tx.send(framed)
            .await
            .map_err(|e| format!("发送 LSP 消息失败: {e}"))
    }

    pub async fn stop_session(&self, args: LspSessionIdArgs) -> Result<(), String> {
        let kill_tx = {
            let mut sessions = self.inner.sessions.write().await;
            let Some(record) = sessions.get_mut(&args.session_id) else {
                return Ok(());
            };

            if let Some(write_tx) = record.write_tx.take() {
                drop(write_tx);
            }

            record.kill_tx.take()
        };

        if let Some(kill_tx) = kill_tx {
            let _ = kill_tx.send(());
        }

        Ok(())
    }

    fn spawn_writer_task(
        &self,
        session_id: &str,
        stdin: ChildStdin,
        mut write_rx: mpsc::Receiver<Vec<u8>>,
    ) {
        let mut writer = BufWriter::new(stdin);
        let app = self.inner.app.clone();
        let session_id = session_id.to_string();

        tokio::spawn(async move {
            while let Some(message) = write_rx.recv().await {
                if let Err(err) = writer.write_all(&message).await {
                    let _ = writer.shutdown().await;
                    eprintln!("[truidide::lsp] LSP 会话 {} 写入失败: {}", session_id, err);
                    break;
                }

                if let Err(err) = writer.flush().await {
                    eprintln!("[truidide::lsp] LSP 会话 {} 刷新失败: {}", session_id, err);
                    break;
                }
            }

            let _ = writer.shutdown().await;
            let _ = app.emit(
                EVENT_LSP_STDERR,
                &json!({
                    "sessionId": session_id,
                    "data": "LSP 输入管道已关闭"
                }),
            );
        });
    }

    fn spawn_reader_task(
        &self,
        session_id: &str,
        plugin_id: String,
        language_id: String,
        stdout: ChildStdout,
    ) {
        let app = self.inner.app.clone();
        let session_id = session_id.to_string();
        let plugin_id_clone = plugin_id.clone();
        let language_id_clone = language_id.clone();

        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            loop {
                match read_lsp_message(&mut reader).await {
                    Ok(body) => {
                        if let Ok(value) = serde_json::from_slice::<Value>(&body) {
                            let payload = LspMessagePayload {
                                session_id: session_id.clone(),
                                plugin_id: plugin_id_clone.clone(),
                                language_id: language_id_clone.clone(),
                                body: value,
                            };

                            if let Err(err) = app.emit(EVENT_LSP_MESSAGE, &payload) {
                                eprintln!(
                                    "[truidide::lsp] 广播 LSP 消息失败 (session {}): {}",
                                    session_id, err
                                );
                            }
                        } else {
                            eprintln!(
                                "[truidide::lsp] 无法解析 LSP 消息 (session {}): {}",
                                session_id,
                                String::from_utf8_lossy(&body)
                            );
                        }
                    }
                    Err(ReadMessageError::Eof) => break,
                    Err(ReadMessageError::Io(err)) => {
                        eprintln!(
                            "[truidide::lsp] 读取 LSP 消息失败 (session {}): {}",
                            session_id, err
                        );
                        break;
                    }
                    Err(ReadMessageError::Malformed(headers)) => {
                        eprintln!(
                            "[truidide::lsp] 收到格式错误的 LSP 消息 (session {}): {}",
                            session_id, headers
                        );
                    }
                }
            }
        });
    }

    fn spawn_stderr_task(
        &self,
        session_id: &str,
        plugin_id: String,
        language_id: String,
        stderr: ChildStderr,
    ) {
        let app = self.inner.app.clone();
        let session_id = session_id.to_string();

        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr);
            let mut buffer = String::new();
            loop {
                buffer.clear();
                match reader.read_line(&mut buffer).await {
                    Ok(0) => break,
                    Ok(_) => {
                        let payload = LspStderrPayload {
                            session_id: session_id.clone(),
                            plugin_id: plugin_id.clone(),
                            language_id: language_id.clone(),
                            data: buffer.trim_end_matches('\n').to_string(),
                        };

                        if let Err(err) = app.emit(EVENT_LSP_STDERR, &payload) {
                            eprintln!(
                                "[truidide::lsp] 广播 LSP stderr 失败 (session {}): {}",
                                session_id, err
                            );
                        }
                    }
                    Err(err) => {
                        eprintln!(
                            "[truidide::lsp] 读取 LSP stderr 失败 (session {}): {}",
                            session_id, err
                        );
                        break;
                    }
                }
            }
        });
    }

    fn spawn_wait_task(
        &self,
        session_id: String,
        plugin_id: String,
        language_id: String,
        mut child: Child,
        mut kill_rx: oneshot::Receiver<()>,
    ) {
        let inner = self.inner.clone();

        tokio::spawn(async move {
            let status = tokio::select! {
                _ = &mut kill_rx => {
                    if let Err(err) = child.kill().await {
                        eprintln!(
                            "[truidide::lsp] 终止 LSP 进程失败 (session {}): {}",
                            session_id, err
                        );
                    }
                    child.wait().await
                }
                status = child.wait() => status,
            };

            if let Err(err) = inner
                .handle_session_exit(&session_id, &plugin_id, &language_id, status.ok())
                .await
            {
                eprintln!(
                    "[truidide::lsp] 处理 LSP 会话退出失败 (session {}): {}",
                    session_id, err
                );
            }
        });
    }
}

impl PluginHostInner {
    async fn handle_session_exit(
        &self,
        session_id: &str,
        fallback_plugin_id: &str,
        fallback_language_id: &str,
        status: Option<std::process::ExitStatus>,
    ) -> Result<(), String> {
        let record = {
            let mut sessions = self.sessions.write().await;
            sessions.remove(session_id)
        };

        let (plugin_id, language_id) = if let Some(mut record) = record {
            if let Some(write_tx) = record.write_tx.take() {
                drop(write_tx);
            }
            if let Some(kill_tx) = record.kill_tx.take() {
                let _ = kill_tx.send(());
            }

            (record.plugin_id, record.language_id)
        } else {
            (
                fallback_plugin_id.to_string(),
                fallback_language_id.to_string(),
            )
        };

        let (status_code, signal) = extract_exit_details(status.as_ref());

        let exit_payload = LspExitPayload {
            session_id: session_id.to_string(),
            plugin_id,
            language_id,
            status_code,
            signal,
        };

        self.app
            .emit(EVENT_LSP_EXIT, &exit_payload)
            .map_err(|e: tauri::Error| e.to_string())?;

        Ok(())
    }
}

#[derive(Debug)]
enum ReadMessageError {
    Eof,
    Io(std::io::Error),
    Malformed(String),
}

impl From<std::io::Error> for ReadMessageError {
    fn from(err: std::io::Error) -> ReadMessageError {
        if err.kind() == std::io::ErrorKind::UnexpectedEof {
            ReadMessageError::Eof
        } else {
            ReadMessageError::Io(err)
        }
    }
}

async fn read_lsp_message<R>(reader: &mut BufReader<R>) -> Result<Vec<u8>, ReadMessageError>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut headers = String::new();
    loop {
        headers.clear();
        let mut line = String::new();
        loop {
            line.clear();
            let bytes = reader
                .read_line(&mut line)
                .await
                .map_err(ReadMessageError::from)?;

            if bytes == 0 {
                return Err(ReadMessageError::Eof);
            }

            if line == "\r\n" {
                break;
            }

            headers.push_str(&line);
        }

        let mut content_length: Option<usize> = None;
        for header_line in headers.lines() {
            if let Some((name, value)) = header_line.split_once(':') {
                if name.eq_ignore_ascii_case("content-length") {
                    content_length = value.trim().parse::<usize>().ok();
                    break;
                }
            }
        }

        let Some(length) = content_length else {
            return Err(ReadMessageError::Malformed(headers));
        };

        let mut body = vec![0u8; length];
        reader
            .read_exact(&mut body)
            .await
            .map_err(ReadMessageError::from)?;
        return Ok(body);
    }
}

pub(crate) fn resolve_plugin_directories(
    app: &AppHandle,
) -> Result<PluginDirectoriesConfig, String> {
    let mut config = PluginDirectoriesConfig::default();

    let user_dir = app
        .path()
        .resolve("plugins", BaseDirectory::AppData)
        .map_err(|e| e.to_string())?;
    if !user_dir.exists() {
        std::fs::create_dir_all(&user_dir).map_err(|e| format!("创建用户插件目录失败: {e}"))?;
    }
    config.user.push(user_dir);

    if let Ok(built_in_dir) = app.path().resolve("plugins", BaseDirectory::Resource) {
        config.built_in.push(built_in_dir);
    }

    Ok(config)
}

fn extract_exit_details(status: Option<&std::process::ExitStatus>) -> (Option<i32>, Option<i32>) {
    if let Some(status) = status {
        let code = status.code();
        #[cfg(unix)]
        {
            use std::os::unix::process::ExitStatusExt;
            return (code, status.signal());
        }
        #[cfg(not(unix))]
        {
            return (code, None);
        }
    }
    (None, None)
}

#[cfg(target_os = "android")]
async fn spawn_lsp_process(
    app: &AppHandle,
    plugin: &DiscoveredPlugin,
    manifest: &LspPluginManifest,
    workspace_path: &Path,
    session_id: &str,
) -> Result<(Child, Option<PathMapping>), String> {
    use std::os::unix::fs::PermissionsExt;

    let env = prepare_proot_env(app)?;
    let default_plugin_mount = format!("/opt/truidide/plugins/{}", plugin.manifest.id);
    let plugin_mount_path = manifest
        .plugin_mount_path
        .clone()
        .filter(|p| p.starts_with('/'))
        .unwrap_or(default_plugin_mount.clone());

    let default_workspace_mount = "/mnt/workspace".to_string();
    let workspace_mount_path = manifest
        .workspace_mount_path
        .clone()
        .filter(|p| p.starts_with('/'))
        .unwrap_or(default_workspace_mount.clone());

    // ensure host plugin dir is accessible
    let mut command = Command::new(&env.proot_bin);
    command.arg(format!("--rootfs={}", env.rootfs_dir.to_string_lossy()));
    command.arg("--kill-on-exit");
    command.arg("--link2symlink");
    command.arg("--root-id");
    command.arg("--bind=/dev");
    command.arg("--bind=/proc");
    command.arg("--bind=/sys");
    command.arg("--bind=/dev/urandom:/dev/random");

    // 注意：不要绑定 /proc/self/fd/* 因为 LSP 使用 pipes 而不是 PTY
    // 这些绑定在 PTY 环境（如终端）中有效，但在 pipe 环境中会失败

    command.arg(format!(
        "--bind={}:{}",
        plugin.root_dir.to_string_lossy(),
        plugin_mount_path
    ));

    command.arg(format!(
        "--bind={}:{}",
        workspace_path.to_string_lossy(),
        workspace_mount_path
    ));

    command.env("PROOT_TMP_DIR", env.tmp_dir.to_string_lossy().to_string());
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env("TRUIDIDE_SESSION_ID", session_id);
    command.env("TRUIDIDE_PLUGIN_ID", &plugin.manifest.id);
    command.env("TRUIDIDE_PLUGIN_ROOT", &plugin_mount_path);
    command.env("TRUIDIDE_WORKSPACE_PATH", &workspace_mount_path);
    command.env(
        "TRUIDIDE_WORKSPACE_HOST_PATH",
        workspace_path.to_string_lossy().to_string(),
    );
    command.env(
        "TRUIDIDE_PLUGIN_HOST_ROOT",
        plugin.root_dir.to_string_lossy().to_string(),
    );

    // 先应用插件定义的环境变量
    for (key, value) in &manifest.env {
        command.env(key, value);
    }

    // 然后设置 PATH（确保不会被插件覆盖）
    // 如果插件已经设置了 PATH，我们追加到它后面；否则使用默认值
    let default_path = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
    if let Some(plugin_path) = manifest.env.get("PATH") {
        if !plugin_path.is_empty() {
            command.env("PATH", format!("{}:{}", plugin_path, default_path));
        } else {
            command.env("PATH", default_path);
        }
    } else {
        command.env("PATH", default_path);
    }

    // 处理命令路径
    // 1. 如果以 / 开头，是绝对路径，直接使用
    // 2. 如果包含 / 但不以 / 开头，是相对于插件目录的路径
    // 3. 如果不包含 /，可能是系统命令（如 node、python）或插件目录下的文件
    let guest_command_path = if manifest.command.starts_with('/') {
        // 绝对路径
        manifest.command.clone()
    } else if manifest.command.contains('/') {
        // 相对路径（如 bin/server）
        format!("{}/{}", plugin_mount_path, manifest.command)
    } else {
        // 可能是系统命令（如 node）或插件目录下的文件
        // 先检查插件目录下是否存在该文件
        let plugin_file = plugin.root_dir.join(&manifest.command);
        if plugin_file.exists() {
            // 插件目录下有该文件
            format!("{}/{}", plugin_mount_path, manifest.command)
        } else {
            // 当作系统命令，直接使用（依赖 PATH）
            manifest.command.clone()
        }
    };

    let guest_cwd = manifest
        .cwd
        .clone()
        .map(|cwd| {
            if cwd.starts_with('/') {
                cwd
            } else {
                format!("{}/{}", plugin_mount_path, cwd)
            }
        })
        .unwrap_or(plugin_mount_path.clone());
    command.arg(format!("--cwd={}", guest_cwd));

    // 直接添加要执行的命令（不需要 -- 分隔符）
    command.arg(&guest_command_path);
    for arg in &manifest.args {
        command.arg(arg);
    }

    // 调试日志：打印完整的 PRoot 命令
    eprintln!("[LSP] Spawning PRoot command:");
    eprintln!("  Program: {}", env.proot_bin.to_string_lossy());
    eprintln!("  Command: {}", guest_command_path);
    eprintln!("  Args: {:?}", manifest.args);
    eprintln!("  CWD: {}", guest_cwd);

    command
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let child = command
        .spawn()
        .map_err(|e| format!("启动 LSP 插件失败 (proot): {e}"))?;

    let path_mapping = PathMapping {
        host_workspace: workspace_path.to_string_lossy().to_string(),
        guest_workspace: workspace_mount_path,
        host_plugin: plugin.root_dir.to_string_lossy().to_string(),
        guest_plugin: plugin_mount_path,
    };

    Ok((child, Some(path_mapping)))
}

#[cfg(not(target_os = "android"))]
async fn spawn_lsp_process(
    _app: &AppHandle,
    plugin: &DiscoveredPlugin,
    manifest: &LspPluginManifest,
    workspace_path: &Path,
    session_id: &str,
) -> Result<(Child, Option<PathMapping>), String> {
    let command_candidate = PathBuf::from(&manifest.command);
    let (mut command, program_display) = if command_candidate.is_absolute() {
        (
            Command::new(&command_candidate),
            command_candidate.to_string_lossy().to_string(),
        )
    } else {
        let joined = plugin.root_dir.join(&command_candidate);
        if joined.exists() {
            (Command::new(&joined), joined.to_string_lossy().to_string())
        } else {
            (Command::new(&manifest.command), manifest.command.clone())
        }
    };
    command.args(&manifest.args);

    // 清除 Yarn PnP 相关的环境变量，防止干扰 LSP 进程
    command.env_remove("NODE_OPTIONS");
    // 设置 YARN_IGNORE_PATH 告诉 Node.js 不要使用 Yarn PnP
    command.env("YARN_IGNORE_PATH", "1");

    for (key, value) in &manifest.env {
        command.env(key, value);
    }

    command.env(
        "TRUIDIDE_PLUGIN_ROOT",
        plugin.root_dir.to_string_lossy().to_string(),
    );
    command.env(
        "TRUIDIDE_WORKSPACE_PATH",
        workspace_path.to_string_lossy().to_string(),
    );
    command.env(
        "TRUIDIDE_WORKSPACE_HOST_PATH",
        workspace_path.to_string_lossy().to_string(),
    );
    command.env(
        "TRUIDIDE_PLUGIN_HOST_ROOT",
        plugin.root_dir.to_string_lossy().to_string(),
    );
    command.env("TRUIDIDE_SESSION_ID", session_id);
    command.env("TRUIDIDE_PLUGIN_ID", &plugin.manifest.id);

    let working_dir = manifest
        .cwd
        .as_ref()
        .map(|cwd| {
            let cwd_path = PathBuf::from(cwd);
            if cwd_path.is_absolute() {
                cwd_path
            } else {
                plugin.root_dir.join(cwd_path)
            }
        })
        .unwrap_or_else(|| plugin.root_dir.clone());
    let working_dir_display = working_dir.to_string_lossy().to_string();
    command.current_dir(&working_dir);

    eprintln!(
        "[truidide::lsp] spawning plugin {} => program: {} cwd: {} args: {:?}",
        plugin.manifest.id, program_display, working_dir_display, manifest.args,
    );

    command
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    let child = command.spawn().map_err(|e| {
        format!(
            "启动 LSP 插件失败: {e} (program: {} cwd: {})",
            program_display, working_dir_display
        )
    })?;

    // Desktop platforms don't need path mapping
    Ok((child, None))
}

#[cfg(debug_assertions)]
fn describe_message(value: &Value) -> String {
    if let Some(method) = value.get("method").and_then(|m| m.as_str()) {
        if value.get("id").is_some() {
            return format!("request {}", method);
        }
        return format!("notification {}", method);
    }
    if let Some(id) = value.get("id") {
        return format!("response id {}", id);
    }
    "message".to_string()
}
