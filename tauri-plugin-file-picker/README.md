# Tauri Plugin - File Picker

这是一个为 TruidIDE 创建的 Tauri 移动端插件，用于处理 Android 平台的 Content URI 文件读取问题。

## 背景

在 Android 平台上，文件选择器返回的是 `content://` URI 而不是文件系统路径。Tauri 的 `tauri-plugin-fs` 不支持直接读取这类 URI，因此需要通过原生 Android 代码来处理。

## 功能

### Android 端
- 读取 Content URI 并复制到指定路径
- 读取 Content URI 并返回 Base64 编码的内容

### Desktop 端
- 不支持 Content URI（返回错误）

## API

### `readContentUri`

从 Content URI 读取文件。

**参数：**
- `contentUri`: string - Content URI（必需，格式：`content://...`）
- `targetPath`: string | undefined - 目标文件路径（可选）

**返回值：**
- `success`: boolean - 操作是否成功
- `path`: string | undefined - 保存的文件路径（当提供 targetPath 时）
- `content`: string | undefined - Base64 编码的文件内容（未提供 targetPath 时）
- `size`: number | undefined - 文件大小（字节）

## 使用示例

在 Rust 代码中使用：

```rust
use tauri_plugin_file_picker::{FilePickerExt, ReadContentUriRequest};

// 从 Content URI 复制到文件
let response = app
    .file_picker()
    .read_content_uri(ReadContentUriRequest {
        content_uri: "content://...".to_string(),
        target_path: Some("/path/to/file.zip".to_string()),
    })
    .unwrap();

if response.success {
    println!("文件已保存到: {:?}", response.path);
}
```

## 集成到主项目

1. 在 `src-tauri/Cargo.toml` 中添加依赖：
```toml
[dependencies]
tauri-plugin-file-picker = { path = "../tauri-plugin-file-picker" }
```

2. 在 `src-tauri/src/lib.rs` 中注册插件：
```rust
.plugin(tauri_plugin_file_picker::init())
```

3. 在 `src-tauri/capabilities/default.json` 中添加权限：
```json
{
  "permissions": [
    "file-picker:default"
  ]
}
```

## 技术实现

### Android 实现
- 使用 `ContentResolver.openInputStream()` 读取 Content URI
- 支持复制到本地文件或直接返回内容
- 自动创建目标目录

### Rust 桥接
- 通过 `PluginHandle.run_mobile_plugin()` 调用 Android 原生方法
- 使用 Serde 序列化/反序列化参数和返回值

## 许可证

与 TruidIDE 项目相同

