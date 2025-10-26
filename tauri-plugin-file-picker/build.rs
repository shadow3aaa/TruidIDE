const COMMANDS: &[&str] = &["ping", "read_content_uri"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build()
}
