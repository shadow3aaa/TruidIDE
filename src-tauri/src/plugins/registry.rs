use crate::plugins::{LspPluginManifest, PluginKind, PluginManifest};
use serde::Deserialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

const MANIFEST_FILENAME: &str = "truid-plugin.json";

#[derive(Debug, Clone)]
pub struct DiscoveredPlugin {
    pub manifest: PluginManifest,
    pub root_dir: PathBuf,
    pub location: PluginLocation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PluginLocation {
    User,
    BuiltIn,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDirectoriesConfig {
    #[serde(default)]
    pub user: Vec<PathBuf>,
    #[serde(default)]
    pub built_in: Vec<PathBuf>,
}

impl Default for PluginDirectoriesConfig {
    fn default() -> Self {
        Self {
            user: vec![],
            built_in: vec![],
        }
    }
}

#[derive(Default)]
pub struct PluginRegistry {
    user_dirs: Vec<PathBuf>,
    built_in_dirs: Vec<PathBuf>,
    plugins: HashMap<String, DiscoveredPlugin>,
}

impl PluginRegistry {
    pub fn with_directories(config: PluginDirectoriesConfig) -> Self {
        Self {
            user_dirs: config.user,
            built_in_dirs: config.built_in,
            plugins: HashMap::new(),
        }
    }

    pub fn refresh(&mut self) -> Result<(), String> {
        let mut seen = HashMap::<String, DiscoveredPlugin>::new();

        for (location, dirs) in [
            (PluginLocation::User, self.user_dirs.clone()),
            (PluginLocation::BuiltIn, self.built_in_dirs.clone()),
        ] {
            for dir in dirs {
                self.scan_directory(location, &dir, &mut seen)?;
            }
        }

        self.plugins = seen;
        Ok(())
    }

    fn scan_directory(
        &self,
        location: PluginLocation,
        dir: &Path,
        seen: &mut HashMap<String, DiscoveredPlugin>,
    ) -> Result<(), String> {
        if !dir.exists() {
            return Ok(());
        }

        for entry in fs::read_dir(dir).map_err(|e| format!("读取插件目录失败: {e}"))? {
            let entry = entry.map_err(|e| format!("读取插件目录项失败: {e}"))?;
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let manifest_path = path.join(MANIFEST_FILENAME);
            if !manifest_path.exists() {
                continue;
            }

            let manifest_str = fs::read_to_string(&manifest_path)
                .map_err(|e| format!("读取插件清单失败 ({}): {e}", manifest_path.display()))?;
            let manifest: PluginManifest = serde_json::from_str(&manifest_str)
                .map_err(|e| format!("解析插件清单失败 ({}): {e}", manifest_path.display()))?;

            if let Some(existing) = seen.get(&manifest.id) {
                // Prefer user-installed plugins over built-in ones.
                // Here we simply skip duplicates, but this can be extended later.
                if existing.location == PluginLocation::User {
                    continue;
                }
            }

            seen.insert(
                manifest.id.clone(),
                DiscoveredPlugin {
                    manifest,
                    root_dir: path,
                    location,
                },
            );
        }

        Ok(())
    }

    pub fn plugin_for_language(&self, language_id: &str) -> Option<&DiscoveredPlugin> {
        self.plugins
            .values()
            .find(|plugin| match &plugin.manifest.kind {
                PluginKind::Lsp(manifest) => {
                    manifest.language_ids.iter().any(|id| id == language_id)
                }
            })
    }

    pub fn all_plugins(&self) -> impl Iterator<Item = (&String, &DiscoveredPlugin)> {
        self.plugins.iter()
    }

    pub fn get_lsp_manifest(
        &self,
        plugin_id: &str,
    ) -> Option<(&DiscoveredPlugin, &LspPluginManifest)> {
        self.plugins
            .get(plugin_id)
            .and_then(|plugin| match &plugin.manifest.kind {
                PluginKind::Lsp(manifest) => Some((plugin, manifest)),
            })
    }
}
