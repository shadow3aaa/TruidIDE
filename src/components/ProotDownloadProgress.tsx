import {
  useEffect,
  useState,
  createContext,
  useContext,
  ReactNode,
} from "react";
import {
  listenToDownloadProgress,
  checkProotStatus,
  downloadProotAssets,
  formatBytes,
  type DownloadProgress,
} from "@/lib/android-assets-download";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// 创建 Context 用于共享下载状态
const DownloadStatusContext = createContext<{
  isDownloading: boolean;
  isReady: boolean;
}>({
  isDownloading: false,
  isReady: true,
});

export function useDownloadStatus() {
  return useContext(DownloadStatusContext);
}

// Provider 组件，包裹整个应用
export function DownloadStatusProvider({ children }: { children: ReactNode }) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [isReady, setIsReady] = useState(true);

  useEffect(() => {
    // 检查初始状态
    checkProotStatus().then((ready) => {
      setIsReady(ready);
    });

    let unlisten: (() => void) | undefined;

    listenToDownloadProgress((prog) => {
      // 设置下载状态
      const downloading =
        prog.stage === "downloading" || prog.stage === "extracting";
      setIsDownloading(downloading);

      // 完成或出错后重置状态
      if (prog.stage === "completed") {
        setIsReady(true);
        setTimeout(() => {
          setIsDownloading(false);
        }, 3000);
      } else if (prog.stage === "error") {
        setTimeout(() => {
          setIsDownloading(false);
        }, 3000);
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  return (
    <DownloadStatusContext.Provider value={{ isDownloading, isReady }}>
      {children}
    </DownloadStatusContext.Provider>
  );
}

export function ProotDownloadProgress() {
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isReady, setIsReady] = useState(true);
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    // 检查初始状态
    checkProotStatus().then((ready) => {
      setIsReady(ready);
      if (!ready) {
        setIsVisible(true); // 如果未准备好，显示下载提示
      }
    });

    let unlisten: (() => void) | undefined;

    listenToDownloadProgress((prog) => {
      setProgress(prog);
      setIsVisible(true);

      // 完成或出错后 3 秒隐藏
      if (prog.stage === "completed") {
        setIsReady(true);
        setTimeout(() => setIsVisible(false), 3000);
      } else if (prog.stage === "error") {
        setTimeout(() => setIsVisible(false), 5000);
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  const handleStartDownload = async () => {
    setIsStarting(true);
    try {
      await downloadProotAssets();
    } catch (e) {
      console.error("下载失败:", e);
      setProgress({
        stage: "error",
        message: String(e),
      });
    } finally {
      setIsStarting(false);
    }
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-96 pb-safe">
      <Card className="p-4 shadow-lg">
        <div className="space-y-3">
          {/* 标题 */}
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">
              {!progress && !isReady && "需要下载运行环境"}
              {progress?.stage === "downloading" && "正在下载资源"}
              {progress?.stage === "extracting" && "正在解压文件"}
              {progress?.stage === "completed" && "✓ 完成"}
              {progress?.stage === "error" && "✗ 错误"}
            </h3>
          </div>

          {/* 未下载状态 - 显示开始按钮 */}
          {!progress && !isReady && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                首次使用需要下载 Linux 运行环境（约 200-300 MB）
              </p>
              <Button
                className="w-full"
                onClick={handleStartDownload}
                disabled={isStarting}
              >
                {isStarting ? "准备中..." : "开始下载"}
              </Button>
            </div>
          )}

          {/* 下载进度 */}
          {progress?.stage === "downloading" && (
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">
                {progress.file}
              </div>

              {/* 进度条 */}
              <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{
                    width: `${progress.percentage ?? 0}%`,
                  }}
                />
              </div>

              {/* 进度信息 */}
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {formatBytes(progress.downloaded)}
                  {progress.total && ` / ${formatBytes(progress.total)}`}
                </span>
                <span>{progress.percentage ?? 0}%</span>
              </div>
            </div>
          )}

          {/* 解压提示 */}
          {progress?.stage === "extracting" && (
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">
                {progress.file}
              </div>

              {progress.percentage !== undefined ? (
                <>
                  {/* 进度条 */}
                  <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full bg-primary transition-all duration-300"
                      style={{
                        width: `${progress.percentage}%`,
                      }}
                    />
                  </div>

                  {/* 进度百分比 */}
                  <div className="text-right text-xs text-muted-foreground">
                    {progress.percentage}%
                  </div>
                </>
              ) : (
                // 没有百分比时显示动画进度条
                <div className="flex items-center gap-2">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full w-full animate-pulse bg-primary" />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 错误信息 */}
          {progress?.stage === "error" && (
            <div className="space-y-2">
              <div className="text-sm text-destructive">{progress.message}</div>
              <Button
                className="w-full"
                variant="outline"
                onClick={handleStartDownload}
                disabled={isStarting}
              >
                重试
              </Button>
            </div>
          )}

          {/* 完成提示 */}
          {progress?.stage === "completed" && (
            <div className="text-sm text-muted-foreground">资源已准备就绪</div>
          )}
        </div>
      </Card>
    </div>
  );
}
