#[cfg(target_os = "android")]
pub mod proot {
    use std::fs::{self, File};
    use std::io::{self, BufReader};
    use std::path::{Path, PathBuf};

    use tauri::path::BaseDirectory;
    use tauri::{AppHandle, Manager};
    use xz2::bufread::XzDecoder;

    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    #[derive(Clone, Debug)]
    pub struct ProotEnv {
        pub base_dir: PathBuf,
        pub proot_bin: PathBuf,
        pub rootfs_root: PathBuf,
        pub rootfs_dir: PathBuf,
        pub tmp_dir: PathBuf,
    }

    fn decompress_tar_xz(src: &Path, dest: &Path) -> io::Result<()> {
        let file = File::open(src)?;
        let buf_reader = BufReader::new(file);
        let xz_decoder = XzDecoder::new(buf_reader);
        let mut archive = tar::Archive::new(xz_decoder);
        archive.unpack(dest)?;
        Ok(())
    }

    pub fn prepare_proot_env(app: &AppHandle) -> Result<ProotEnv, String> {
        let appdata_base = app
            .path()
            .resolve("files/proot", BaseDirectory::AppData)
            .map_err(|e| e.to_string())?;

        if !appdata_base.exists() {
            return Err(format!(
                "应用私有目录中未找到 proot 目录：{}，请确保应用已在启动时解压 assets/proot 到 files/proot",
                appdata_base.to_string_lossy()
            ));
        }

        let dest = appdata_base;
        let rootfs_root = dest.join("rootfs");
        if !rootfs_root.exists() {
            let compressed = dest.join("rootfs.tar.xz");
            if !compressed.exists() {
                return Err(format!(
                    "rootfs 未解压到 {}，请确保已将 rootfs 解压到该目录或将 rootfs.tar.xz 放在此目录以启用自动解压",
                    rootfs_root.to_string_lossy()
                ));
            }

            decompress_tar_xz(&compressed, &rootfs_root)
                .map_err(|e| format!("解压 rootfs 失败: {e:?}"))?;
        }

        // Ensure proot binaries are executable
        let proot_path = dest.join("proot/bin/proot");
        let loader_path = dest.join("proot/libexec/proot/loader");
        let loader32_path = dest.join("proot/libexec/proot/loader32");
        #[cfg(unix)]
        {
            let files_to_make_executable = [&proot_path, &loader_path, &loader32_path];
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

        let mut rootfs_dir = rootfs_root.clone();
        #[cfg(target_arch = "aarch64")]
        {
            rootfs_dir = rootfs_root.join("archlinux-aarch64");
        }
        #[cfg(target_arch = "arm")]
        {
            rootfs_dir = rootfs_root.join("archlinux-armv7l");
        }
        #[cfg(target_arch = "x86_64")]
        {
            rootfs_dir = rootfs_root.join("archlinux-x86_64");
        }
        #[cfg(target_arch = "x86")]
        {
            rootfs_dir = rootfs_root.join("archlinux-x86");
        }

        if !rootfs_dir.exists() {
            return Err(format!(
                "rootfs 未解压或架构目录缺失: {}",
                rootfs_dir.to_string_lossy()
            ));
        }

        let tmp_dir = dest.join("proot_tmp");
        if !tmp_dir.exists() {
            fs::create_dir_all(&tmp_dir).map_err(|e| {
                format!(
                    "无法创建 PROOT_TMP_DIR ({}): {e}",
                    tmp_dir.to_string_lossy()
                )
            })?;
        }

        Ok(ProotEnv {
            base_dir: dest,
            proot_bin: proot_path,
            rootfs_root,
            rootfs_dir,
            tmp_dir,
        })
    }
}
