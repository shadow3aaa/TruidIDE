use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub tags: Vec<String>,
    pub kind: PluginKind,
    #[serde(default)]
    pub extra: HashMap<String, serde_json::Value>,
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum PluginKind {
    Lsp(LspPluginManifest),
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspPluginManifest {
    /// Supported VSCode-style language identifiers.
    pub language_ids: Vec<String>,
    /// Command or executable to spawn. Relative paths resolve against the plugin root.
    pub command: String,
    /// Additional command-line arguments.
    #[serde(default)]
    pub args: Vec<String>,
    /// Environment variables to inject when spawning the plugin.
    #[serde(default)]
    pub env: HashMap<String, String>,
    /// Optional working directory. Relative paths resolve against the plugin root.
    #[serde(default)]
    pub cwd: Option<String>,
    /// User-provided initialization options that will be forwarded to the language server.
    #[serde(default)]
    pub initialization_options: Option<serde_json::Value>,
    /// Android-specific flag to force proot usage even on host platforms (mainly for testing).
    #[serde(default)]
    pub force_proot: bool,
    /// Optional absolute path inside the guest rootfs (proot) to mount the plugin directory to.
    #[serde(default)]
    pub plugin_mount_path: Option<String>,
    /// Optional absolute path inside the guest rootfs (proot) to mount the workspace/project to.
    #[serde(default)]
    pub workspace_mount_path: Option<String>,
}
