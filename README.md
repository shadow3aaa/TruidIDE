# TruidIDE

TruidIDE 基于 Tauri + React 19，目标是为 Android 与桌面环境提供一致的 IDE 体验。本项目包含前端界面与 Tauri 桌面壳。

## 运行

```bash
yarn install
# 桌面
yarn tauri dev
# 安卓
yarn tauri android dev
```

## 插件系统

插件系统用于支持lsp，拓展高亮等功能，目前还在开发测试，api尚未确定。目前可查看[plugins目录](./plugins)看看测试插件。

## Android 支持

为了提供完善的开发环境，在android运行时会使用proot启动的`archlinux arm`容器作为项目环境，插件也在容器中运行。
