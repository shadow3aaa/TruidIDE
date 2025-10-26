#[cfg(target_os = "android")]
pub mod proot {
    use std::fs::{self, File};
    use std::io::{self, BufReader, Write};
    use std::path::{Path, PathBuf};

    use serde::{Deserialize, Serialize};
    use sha2::{Digest, Sha256};
    use tauri::path::BaseDirectory;
    use tauri::{AppHandle, Emitter, Manager};
    use xz2::bufread::XzDecoder;

    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    // GitHub Release 配置
    const GITHUB_REPO: &str = "shadow3aaa/TruidIDE-Public";
    const RELEASE_TAG: &str = "proot-assets"; // proot 和 rootfs 资源包 tag

    // 镜像站点列表（按优先级排序）
    const MIRRORS: &[&str] = &[
        "https://github.com",
        "https://ghproxy.com/https://github.com", // 中国大陆加速镜像
    ];

    /// 下载进度状态
    #[derive(Clone, Debug, Serialize, Deserialize)]
    #[serde(tag = "stage", rename_all = "lowercase")]
    pub enum DownloadProgress {
        Downloading {
            file: String,
            downloaded: u64,
            total: Option<u64>,
            percentage: Option<u8>,
        },
        Extracting {
            file: String,
            #[serde(skip_serializing_if = "Option::is_none")]
            percentage: Option<u8>,
        },
        Completed,
        Error {
            message: String,
        },
    }

    #[derive(Clone, Debug)]
    pub struct ProotEnv {
        pub base_dir: PathBuf,
        pub proot_bin: PathBuf,
        pub rootfs_root: PathBuf,
        pub rootfs_dir: PathBuf,
        pub tmp_dir: PathBuf,
    }

    /// 从 GitHub Release 下载文件（支持进度回调和镜像重试）
    fn download_from_github(
        app: &AppHandle,
        url: &str,
        dest: &Path,
        file_name: &str,
    ) -> io::Result<()> {
        use reqwest::blocking::Client;
        use std::time::Duration;

        let client = Client::builder()
            .timeout(Duration::from_secs(600)) // 10分钟超时
            .build()
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;

        // 发送请求获取文件大小
        let response = client
            .get(url)
            .send()
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;

        if !response.status().is_success() {
            return Err(io::Error::new(
                io::ErrorKind::Other,
                format!("下载失败: HTTP {}", response.status()),
            ));
        }

        let total_size = response.content_length();
        let mut downloaded: u64 = 0;
        let mut file = File::create(dest)?;

        // 使用 response.bytes() 流式读取
        use std::io::Read;
        let mut reader = response;
        let mut buffer = [0u8; 8192];
        let mut last_report_time = std::time::Instant::now();

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    file.write_all(&buffer[..n])?;
                    downloaded += n as u64;

                    // 每隔 500ms 发送一次进度更新
                    if last_report_time.elapsed().as_millis() > 500 {
                        let percentage = total_size
                            .map(|total| ((downloaded as f64 / total as f64) * 100.0) as u8);

                        let _ = app.emit(
                            "proot-download-progress",
                            DownloadProgress::Downloading {
                                file: file_name.to_string(),
                                downloaded,
                                total: total_size,
                                percentage,
                            },
                        );
                        last_report_time = std::time::Instant::now();
                    }
                }
                Err(e) => return Err(e),
            }
        }

        // 发送完成进度
        let _ = app.emit(
            "proot-download-progress",
            DownloadProgress::Downloading {
                file: file_name.to_string(),
                downloaded,
                total: total_size,
                percentage: Some(100),
            },
        );

        Ok(())
    }

    /// 尝试从多个镜像下载文件
    fn download_with_mirrors(
        app: &AppHandle,
        repo: &str,
        tag: &str,
        filename: &str,
        dest: &Path,
    ) -> io::Result<()> {
        let mut last_error = None;

        for mirror in MIRRORS {
            let url = format!("{}/{}/releases/download/{}/{}", mirror, repo, tag, filename);
            eprintln!("正在从镜像下载: {}", mirror);

            match download_from_github(app, &url, dest, filename) {
                Ok(_) => return Ok(()),
                Err(e) => {
                    eprintln!("从镜像 {} 下载失败: {}", mirror, e);
                    last_error = Some(e);
                    // 继续尝试下一个镜像
                }
            }
        }

        Err(last_error
            .unwrap_or_else(|| io::Error::new(io::ErrorKind::Other, "所有镜像都下载失败")))
    }

    /// 验证文件 SHA256
    fn verify_sha256(file_path: &Path, expected_hash: &str) -> io::Result<bool> {
        let mut file = File::open(file_path)?;
        let mut hasher = Sha256::new();
        io::copy(&mut file, &mut hasher)?;
        let hash = format!("{:x}", hasher.finalize());
        Ok(hash == expected_hash)
    }

    /// 获取当前设备架构对应的资源名称
    fn get_arch_suffix() -> &'static str {
        #[cfg(target_arch = "aarch64")]
        return "aarch64";
        #[cfg(target_arch = "arm")]
        return "armv7";
        #[cfg(target_arch = "x86_64")]
        return "x86_64";
        #[cfg(target_arch = "x86")]
        return "x86";
    }

    /// 从 GitHub Release 下载并提取 proot 和 rootfs
    fn download_and_extract_assets(app: &AppHandle, dest: &Path) -> Result<(), String> {
        let arch = get_arch_suffix();

        // 下载 proot-assets-{abi}.zip
        // 这个 ZIP 包含 proot/ 目录和 rootfs.tar.xz 文件
        let abi = match arch {
            "aarch64" => "arm64-v8a",
            "armv7" => "armeabi-v7a",
            "x86_64" => "x86_64",
            "x86" => "x86",
            _ => arch,
        };
        let assets_filename = format!("proot-assets-{}.zip", abi);
        let sha256_filename = format!("proot-assets-{}.zip.sha256", abi);

        eprintln!("目标架构: {}, ABI: {}", arch, abi);

        // 创建临时目录
        let temp_dir = dest.join("temp_download");
        fs::create_dir_all(&temp_dir).map_err(|e| format!("创建临时目录失败: {e}"))?;

        // 下载资源包
        let assets_zip_path = temp_dir.join(&assets_filename);
        let sha256_path = temp_dir.join(&sha256_filename);

        if !assets_zip_path.exists() {
            eprintln!("正在从 GitHub 下载资源包 ({})...", abi);
            download_with_mirrors(
                app,
                GITHUB_REPO,
                RELEASE_TAG,
                &assets_filename,
                &assets_zip_path,
            )
            .map_err(|e| format!("下载资源包失败: {}", e))?;

            // 下载 SHA256 校验文件
            eprintln!("正在下载 SHA256 校验文件...");
            download_with_mirrors(
                app,
                GITHUB_REPO,
                RELEASE_TAG,
                &sha256_filename,
                &sha256_path,
            )
            .map_err(|e| format!("下载 SHA256 文件失败: {}", e))?;

            // 读取期望的 SHA256 值
            let expected_hash = fs::read_to_string(&sha256_path)
                .map_err(|e| format!("读取 SHA256 文件失败: {}", e))?
                .trim()
                .to_lowercase();

            // 验证文件完整性
            eprintln!("正在验证文件完整性...");
            if !verify_sha256(&assets_zip_path, &expected_hash)
                .map_err(|e| format!("SHA256 校验失败: {}", e))?
            {
                // 校验失败，删除下载的文件
                let _ = fs::remove_file(&assets_zip_path);
                let _ = fs::remove_file(&sha256_path);
                return Err("文件校验失败，SHA256 不匹配！文件可能已损坏或被篡改。".to_string());
            }
            eprintln!("文件校验通过！");
        }

        // 解压资源包到目标目录
        eprintln!("正在解压资源包...");

        let file = File::open(&assets_zip_path).map_err(|e| format!("打开资源包失败: {e}"))?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("读取资源包失败: {e}"))?;

        // 逐个文件解压，显示进度
        let total_files = archive.len();
        for i in 0..total_files {
            let mut file = archive
                .by_index(i)
                .map_err(|e| format!("读取压缩包条目失败: {e}"))?;

            let outpath = match file.enclosed_name() {
                Some(path) => dest.join(path),
                None => continue,
            };

            if file.name().ends_with('/') {
                fs::create_dir_all(&outpath).map_err(|e| format!("创建目录失败: {e}"))?;
            } else {
                if let Some(p) = outpath.parent() {
                    if !p.exists() {
                        fs::create_dir_all(p).map_err(|e| format!("创建父目录失败: {e}"))?;
                    }
                }
                let mut outfile =
                    File::create(&outpath).map_err(|e| format!("创建文件失败: {e}"))?;
                io::copy(&mut file, &mut outfile).map_err(|e| format!("解压文件失败: {e}"))?;
            }

            // 每处理一个文件就发送进度
            let percentage = ((i + 1) as f64 / total_files as f64 * 100.0) as u8;
            let _ = app.emit(
                "proot-download-progress",
                DownloadProgress::Extracting {
                    file: format!("{} ({}/{})", assets_filename, i + 1, total_files),
                    percentage: Some(percentage),
                },
            );
        }

        // 删除压缩包以节省空间
        let _ = fs::remove_file(&assets_zip_path);

        // 清理临时目录
        let _ = fs::remove_dir_all(&temp_dir);

        // 设置 proot 二进制文件的可执行权限
        #[cfg(unix)]
        {
            let proot_path = dest.join("proot/bin/proot");
            let loader_path = dest.join("proot/libexec/proot/loader");
            let loader32_path = dest.join("proot/libexec/proot/loader32");
            let files_to_make_executable = [&proot_path, &loader_path, &loader32_path];

            for file_path in &files_to_make_executable {
                if file_path.exists() {
                    if let Ok(metadata) = fs::metadata(file_path) {
                        let mut perms = metadata.permissions();
                        let current_mode = perms.mode();
                        let new_mode = current_mode | 0o111;
                        if current_mode != new_mode {
                            perms.set_mode(new_mode);
                            let _ = fs::set_permissions(file_path, perms);
                        }
                    }
                }
            }
        }

        Ok(())
    }

    fn decompress_tar_xz(app: &AppHandle, src: &Path, dest: &Path) -> io::Result<()> {
        use std::fs;

        // 创建目标目录
        if dest.symlink_metadata().is_err() {
            fs::create_dir_all(&dest)?;
        }

        let file = File::open(src)?;
        let buf_reader = BufReader::new(file);
        let xz_decoder = XzDecoder::new(buf_reader);
        let mut archive = tar::Archive::new(xz_decoder);

        // 手动实现 unpack 逻辑以支持进度报告
        let dst = &dest.canonicalize().unwrap_or(dest.to_path_buf());

        let mut directories = Vec::new();
        let mut file_count = 0;
        let mut last_report_time = std::time::Instant::now();

        for entry in archive.entries()? {
            let mut file = entry?;

            if file.header().entry_type() == tar::EntryType::Directory {
                directories.push(file);
            } else {
                file.unpack_in(dst)?;
                file_count += 1;

                // 每隔 500ms 或每 50 个文件报告一次进度
                if last_report_time.elapsed().as_millis() > 500 || file_count % 50 == 0 {
                    let _ = app.emit(
                        "proot-download-progress",
                        DownloadProgress::Extracting {
                            file: format!("rootfs.tar.xz ({} 个文件)", file_count),
                            percentage: None, // tar 无法预知总数
                        },
                    );
                    last_report_time = std::time::Instant::now();
                }
            }
        }

        // 应用目录（按逆序以确保权限正确）
        directories.sort_by(|a, b| b.path_bytes().cmp(&a.path_bytes()));
        for mut dir in directories {
            dir.unpack_in(dst)?;
        }

        Ok(())
    }

    /// 检查 proot 资源状态（不下载）
    pub async fn check_proot_status(app: AppHandle) -> Result<bool, String> {
        tauri::async_runtime::spawn_blocking(move || {
            let appdata_base = app
                .path()
                .resolve("files/proot", BaseDirectory::AppData)
                .map_err(|e| e.to_string())?;

            // 检查是否已下载
            if !appdata_base.exists()
                || fs::read_dir(&appdata_base)
                    .map(|mut d| d.next().is_none())
                    .unwrap_or(true)
            {
                return Ok(false); // 未下载
            }

            // 检查 rootfs 是否已解压
            let rootfs_root = appdata_base.join("rootfs");
            if !rootfs_root.exists() {
                return Ok(false); // 未完全准备好
            }

            Ok(true) // 已准备好
        })
        .await
        .map_err(|e| format!("检查状态失败: {e}"))?
    }

    /// 下载并准备 proot 环境（用户手动触发）
    pub async fn download_and_prepare_proot(app: AppHandle) -> Result<(), String> {
        tauri::async_runtime::spawn_blocking(move || {
            let appdata_base = app
                .path()
                .resolve("files/proot", BaseDirectory::AppData)
                .map_err(|e| e.to_string())?;

            // 如果已经存在，跳过下载
            if appdata_base.exists()
                && fs::read_dir(&appdata_base)
                    .map(|mut d| d.next().is_some())
                    .unwrap_or(false)
            {
                let rootfs_root = appdata_base.join("rootfs");
                if rootfs_root.exists() {
                    let _ = app.emit("proot-download-progress", DownloadProgress::Completed);
                    return Ok(());
                }
            }

            fs::create_dir_all(&appdata_base).map_err(|e| format!("创建 proot 目录失败: {e}"))?;

            eprintln!("正在从 GitHub 下载 proot 和 rootfs...");

            // 下载资源
            if let Err(e) = download_and_extract_assets(&app, &appdata_base) {
                let _ = app.emit(
                    "proot-download-progress",
                    DownloadProgress::Error { message: e.clone() },
                );
                return Err(e);
            }

            // 检查是否需要解压 rootfs
            let rootfs_root = appdata_base.join("rootfs");
            if !rootfs_root.exists() {
                let compressed = appdata_base.join("rootfs.tar.xz");
                if compressed.exists() {
                    eprintln!("正在解压 rootfs (首次运行可能需要几分钟)...");

                    decompress_tar_xz(&app, &compressed, &rootfs_root)
                        .map_err(|e| format!("解压 rootfs 失败: {e:?}"))?;

                    // 解压成功后可以删除压缩包以节省空间
                    let _ = fs::remove_file(&compressed);
                }
            }

            // 发送完成事件
            let _ = app.emit("proot-download-progress", DownloadProgress::Completed);

            Ok(())
        })
        .await
        .map_err(|e| format!("后台任务执行失败: {e}"))?
    }

    /// 检查并初始化 proot 环境（已废弃，保留以兼容旧代码）
    #[deprecated(note = "使用 check_proot_status 和 download_and_prepare_proot 代替")]
    pub async fn check_and_prepare_proot(app: AppHandle) -> Result<(), String> {
        // 在后台线程执行，避免阻塞主线程
        tauri::async_runtime::spawn_blocking(move || {
            // 只检查和下载资源，不完全初始化环境
            let appdata_base = app
                .path()
                .resolve("files/proot", BaseDirectory::AppData)
                .map_err(|e| e.to_string())?;

            // 如果目录不存在或为空，从 GitHub 下载
            if !appdata_base.exists()
                || fs::read_dir(&appdata_base)
                    .map(|mut d| d.next().is_none())
                    .unwrap_or(true)
            {
                fs::create_dir_all(&appdata_base)
                    .map_err(|e| format!("创建 proot 目录失败: {e}"))?;

                eprintln!("首次运行，正在从 GitHub 下载 proot 和 rootfs...");

                // 下载资源
                if let Err(e) = download_and_extract_assets(&app, &appdata_base) {
                    // 发送错误事件
                    let _ = app.emit(
                        "proot-download-progress",
                        DownloadProgress::Error { message: e.clone() },
                    );
                    return Err(e);
                }

                // 检查是否需要解压 rootfs
                let rootfs_root = appdata_base.join("rootfs");
                if !rootfs_root.exists() {
                    let compressed = appdata_base.join("rootfs.tar.xz");
                    if compressed.exists() {
                        eprintln!("正在解压 rootfs (首次运行可能需要几分钟)...");

                        decompress_tar_xz(&app, &compressed, &rootfs_root)
                            .map_err(|e| format!("解压 rootfs 失败: {e:?}"))?;

                        // 解压成功后可以删除压缩包以节省空间
                        let _ = fs::remove_file(&compressed);
                    }
                }

                // 发送完成事件
                let _ = app.emit("proot-download-progress", DownloadProgress::Completed);
            }

            Ok(())
        })
        .await
        .map_err(|e| format!("后台任务执行失败: {e}"))??;

        Ok(())
    }

    pub fn prepare_proot_env(app: &AppHandle) -> Result<ProotEnv, String> {
        let appdata_base = app
            .path()
            .resolve("files/proot", BaseDirectory::AppData)
            .map_err(|e| e.to_string())?;

        // 如果资源还没下载，直接返回错误（不在这里下载）
        if !appdata_base.exists()
            || fs::read_dir(&appdata_base)
                .map(|mut d| d.next().is_none())
                .unwrap_or(true)
        {
            return Err("Proot 资源尚未准备就绪，请等待下载完成".to_string());
        }

        let dest = appdata_base;
        let rootfs_root = dest.join("rootfs");

        // 如果 rootfs 还未解压，也返回错误
        if !rootfs_root.exists() {
            return Err("Rootfs 尚未解压完成，请等待初始化完成".to_string());
        }

        // 权限设置已在下载时完成，无需再次检查
        let proot_path = dest.join("proot/bin/proot");
        if !proot_path.exists() {
            return Err(format!(
                "必需的文件未找到: {}，请确保资源已正确下载",
                proot_path.to_string_lossy()
            ));
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

        // 发送完成事件（如果还没发送过的话）
        let _ = app.emit("proot-download-progress", DownloadProgress::Completed);

        Ok(ProotEnv {
            base_dir: dest,
            proot_bin: proot_path,
            rootfs_root,
            rootfs_dir,
            tmp_dir,
        })
    }
}
