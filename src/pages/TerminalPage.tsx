import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Home, Menu, Puzzle, X } from "lucide-react";
import { platform } from "@tauri-apps/plugin-os";
import { homeDir } from "@tauri-apps/api/path";

import { Button } from "@/components/ui/button";
import TerminalTab from "@/components/TerminalTab";
import { useDownloadStatus } from "@/components/ProotDownloadProgress";

function TerminalPage() {
  const navigate = useNavigate();
  const [cwd, setCwd] = useState<string | null>(null);
  const [isAndroid, setIsAndroid] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { isReady, isDownloading } = useDownloadStatus();
  const [isSidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    try {
      const value = platform();
      setIsAndroid(value === "android");
    } catch {
      setIsAndroid(false);
    }
  }, []);

  useEffect(() => {
    setLoadError(null);
    if (isAndroid) {
      setCwd("/root");
      return;
    }

    let cancelled = false;
    setCwd(null);

    homeDir()
      .then((dir) => {
        if (cancelled) return;
        const normalized = dir.trim();
        setCwd(normalized.length > 0 ? normalized : dir);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(
          typeof err === "string"
            ? err
            : err instanceof Error
              ? err.message
              : "无法获取主目录",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [isAndroid]);

  const renderTerminalBody = () => {
    if (isAndroid && !isReady) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <p>终端环境尚未准备就绪，请先在主页完成 Proot 下载。</p>
          {isDownloading ? <p>正在下载资源…</p> : null}
          <Button variant="outline" onClick={() => navigate("/")}>
            返回主页
          </Button>
        </div>
      );
    }

    if (loadError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-destructive">
          <p>无法初始化终端：{loadError}</p>
          <Button variant="outline" onClick={() => navigate("/")}>
            返回主页
          </Button>
        </div>
      );
    }

    if (!cwd) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          正在准备终端环境…
        </div>
      );
    }

    return (
      <div className="flex h-full flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-hidden rounded-2xl border bg-card shadow-sm">
          <TerminalTab projectPath={cwd} />
        </div>
      </div>
    );
  };

  return (
    <div
      className="flex min-h-0 overflow-hidden bg-background text-foreground"
      style={{
        paddingTop: "var(--safe-area-inset-top, 0)",
        paddingBottom: "var(--safe-area-inset-bottom, 0)",
        minHeight: "100dvh",
        height: "100dvh",
      }}
    >
      {isSidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-label="关闭侧边栏"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-card px-5 py-6 text-sm text-muted-foreground shadow-lg transition-transform duration-300 ease-in-out lg:static lg:z-auto lg:shadow-none ${isSidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
        style={{
          paddingTop: "max(1.5rem, var(--safe-area-inset-top, 0))",
          paddingBottom: "max(1.5rem, var(--safe-area-inset-bottom, 0))",
        }}
      >
        <div className="flex items-center justify-between gap-2 border-b pb-4">
          <h1 className="truncate text-lg font-semibold text-foreground">
            终端
          </h1>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="关闭侧边栏"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <nav className="mt-6 flex flex-col gap-2">
          <Button
            type="button"
            variant="ghost"
            className="justify-start gap-2"
            onClick={() => navigate("/")}
          >
            <Home className="h-4 w-4" />
            主页
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="justify-start gap-2"
            onClick={() => navigate("/plugins")}
          >
            <Puzzle className="h-4 w-4" />
            插件
          </Button>
        </nav>
      </aside>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b bg-card/50 px-4 py-3 backdrop-blur lg:hidden">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(true)}
            aria-label="打开侧边栏"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex flex-1 items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">终端</h2>
          </div>
        </div>

        <main className="flex min-h-0 flex-1 flex-col gap-4 p-6">
          {renderTerminalBody()}
        </main>
      </div>
    </div>
  );
}

export default TerminalPage;
