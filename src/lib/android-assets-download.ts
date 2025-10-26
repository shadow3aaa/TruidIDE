// Android 资源下载进度通知
// 用于在首次运行时显示下载状态

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export type DownloadProgress =
  | {
      stage: "downloading";
      file: string;
      downloaded: number;
      total?: number;
      percentage?: number;
    }
  | {
      stage: "extracting";
      file: string;
      percentage?: number;
    }
  | {
      stage: "completed";
    }
  | {
      stage: "error";
      message: string;
    };

// 检查 proot 资源状态
export async function checkProotStatus(): Promise<boolean> {
  try {
    return await invoke<boolean>("check_proot_status");
  } catch (e) {
    console.error("检查 proot 状态失败:", e);
    return false;
  }
}

// 开始下载 proot 资源
export async function downloadProotAssets(): Promise<void> {
  await invoke("download_proot_assets");
}

// 监听下载进度事件
export async function listenToDownloadProgress(
  callback: (progress: DownloadProgress) => void,
): Promise<UnlistenFn> {
  return await listen<DownloadProgress>("proot-download-progress", (event) => {
    callback(event.payload);
  });
}

// 格式化文件大小
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

// 格式化下载速度
export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}
