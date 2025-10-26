# TruidIDE

TruidIDE 基于 Tauri + React 19，目标是为 Android 与桌面环境提供一致的 IDE 体验。本项目包含前端界面与 Tauri 桌面壳。

## 开发环境与命令

- 推荐使用 VS Code 搭配 Tauri 扩展与 rust-analyzer。
- 使用 Yarn v4（Zero-Install），常用脚本：
  - `yarn dev`：启动 Vite 前端开发服务器。
  - `yarn tauri dev`：启动桌面壳，支持 Rust/React 热更新。
  - `yarn build`：执行 `tsc` 检查并构建生产包。
  - `yarn preview`：预览生产包。
  - `yarn tauri build`：构建桌面安装包（请确保工作树干净）。

## 插件系统

### 清单示例

```json
{
  "id": "demo-lsp",
  "name": "Demo LSP",
  "version": "0.1.0",
  "enabled": true,
  "kind": {
    "type": "lsp",
    "languageIds": ["typescript"],
    "command": "server/bin/start.sh",
    "args": ["--stdio"],
    "env": {
      "RUST_LOG": "info"
    },
    "cwd": "server",
    "pluginMountPath": "/opt/truidide/plugins/demo",
    "workspaceMountPath": "/mnt/workspace"
  }
}
```

Android 端插件会在 PRoot 沙箱中运行。宿主会自动绑定插件目录与当前工程路径，并注入以下环境变量：

- `TRUIDIDE_PLUGIN_ROOT` / `TRUIDIDE_PLUGIN_HOST_ROOT`
- `TRUIDIDE_WORKSPACE_PATH` / `TRUIDIDE_WORKSPACE_HOST_PATH`
- `TRUIDIDE_PLUGIN_ID` / `TRUIDIDE_SESSION_ID`

### 插件导入

插件管理页支持选择含有 `truid-plugin.json` 的 ZIP 包进行导入。导入后宿主会将插件解压到 `AppData/plugins/<pluginId>` 并刷新索引，该流程在 Android 与桌面环境保持一致。

### 可用 Tauri 命令

| 命令 | 说明 |
| --- | --- |
| `list_plugins` | 返回当前已发现的插件列表 |
| `refresh_plugins` | 重新扫描插件目录并广播变更事件 |
| `start_lsp_session` | 启动指定插件的 LSP 进程并返回会话信息 |
| `send_lsp_payload` | 将 JSON-RPC 消息写入 LSP 会话 |
| `stop_lsp_session` | 主动结束会话并回收子进程 |

### 前端调用示例

```ts
import { listPlugins, startLspSession, sendLspPayload } from "@/lib/plugins";

const plugins = await listPlugins();
const session = await startLspSession({
  pluginId: plugins[0].id,
  workspacePath: project.path,
});
await sendLspPayload({
  sessionId: session.sessionId,
  payload: {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { capabilities: {} },
  },
});
```

## Android PRoot 支持

`src-tauri/src/android.rs` 负责在 Android 端准备 PRoot 环境，解压 rootfs 并修正可执行权限。语言服务插件在移动端默认运行于该沙箱中，以保持与桌面环境接近的运行体验。
