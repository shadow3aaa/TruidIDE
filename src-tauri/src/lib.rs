mod fs_utils;
mod projects;
mod terminal;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_toast::init())
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
            terminal::stop_terminal_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
