mod fs_utils;
mod plugins;
mod projects;
mod terminal;

#[cfg(target_os = "android")]
mod android;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_toast::init())
        .plugin(tauri_plugin_file_picker::init())
        .setup(|app| {
            let app_handle = app.handle();
            match plugins::PluginHost::obtain(&app_handle) {
                Ok(host) => {
                    let refresh_host = host.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(err) = refresh_host.reload_registry().await {
                            eprintln!("[truidide::plugins] 初始刷新插件失败: {}", err);
                        }
                    });
                }
                Err(err) => {
                    eprintln!("[truidide::plugins] 初始化插件宿主失败: {}", err);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            projects::list_projects,
            projects::list_project_tree,
            projects::read_project_file,
            projects::save_project_file,
            projects::create_project_entry,
            projects::delete_project_entry,
            projects::rename_project_entry,
            projects::copy_project_entry,
            projects::move_project_entry,
            projects::resolve_preview_entry,
            projects::create_project,
            terminal::start_terminal_session,
            terminal::list_terminal_sessions,
            terminal::send_terminal_input,
            terminal::attach_terminal_session,
            terminal::detach_terminal_session,
            terminal::resize_terminal,
            terminal::set_terminal_session_title,
            terminal::stop_terminal_session,
            plugins::api::list_plugins,
            plugins::api::refresh_plugins,
            plugins::api::start_lsp_session,
            plugins::api::send_lsp_payload,
            plugins::api::stop_lsp_session,
            plugins::api::import_plugin,
            plugins::api::remove_plugin
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
