import React, { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

export type PluginLogEntry = {
  id: string;
  timestamp: number;
  sessionId: string;
  pluginId: string;
  languageId?: string | null;
  level: "stderr" | "info";
  message: string;
};

type PluginOutputPanelProps = {
  logs: PluginLogEntry[];
  onClear: () => void;
};

function formatTimestamp(value: number): string {
  try {
    return new Date(value).toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return new Date(value).toISOString();
  }
}

export function PluginOutputPanel({ logs, onClear }: PluginOutputPanelProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const previousLengthRef = React.useRef(0);
  const [selectedPluginId, setSelectedPluginId] = React.useState<string | null>(
    null,
  );
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);
  const menuContainerRef = React.useRef<HTMLDivElement | null>(null);

  // 获取所有唯一的插件列表
  const availablePlugins = useMemo(() => {
    const pluginMap = new Map<
      string,
      { id: string; languageId?: string | null }
    >();
    for (const log of logs) {
      const key = `${log.pluginId}::${log.languageId || ""}`;
      if (!pluginMap.has(key)) {
        pluginMap.set(key, { id: log.pluginId, languageId: log.languageId });
      }
    }
    return Array.from(pluginMap.values());
  }, [logs]);

  // 根据选中的插件过滤日志
  const filteredLogs = useMemo(() => {
    if (!selectedPluginId) return logs;
    return logs.filter((log) => log.pluginId === selectedPluginId);
  }, [logs, selectedPluginId]);

  // 获取当前选中插件的显示名称
  const selectedPluginDisplayName = useMemo(() => {
    if (!selectedPluginId) return "所有插件";
    const plugin = availablePlugins.find((p) => p.id === selectedPluginId);
    if (!plugin) return "所有插件";
    return plugin.languageId
      ? `${plugin.id} (${plugin.languageId})`
      : plugin.id;
  }, [selectedPluginId, availablePlugins]);

  // 点击外部关闭菜单
  React.useEffect(() => {
    if (!isMenuOpen) return;
    const handlePointer = (event: MouseEvent | TouchEvent) => {
      const container = menuContainerRef.current;
      if (!container) return;
      if (!container.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("touchstart", handlePointer);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("touchstart", handlePointer);
    };
  }, [isMenuOpen]);

  // ESC 键关闭菜单
  React.useEffect(() => {
    if (!isMenuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

  React.useEffect(() => {
    if (logs.length <= previousLengthRef.current) {
      previousLengthRef.current = logs.length;
      return;
    }

    previousLengthRef.current = logs.length;
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceToBottom = scrollHeight - (scrollTop + clientHeight);
    const shouldStickToBottom = distanceToBottom <= 120;
    if (shouldStickToBottom) {
      container.scrollTo({
        top: scrollHeight,
        behavior: logs.length > 1 ? "smooth" : "auto",
      });
    }
  }, [logs]);

  const handleSelectPlugin = (pluginId: string | null) => {
    setSelectedPluginId(pluginId);
    setIsMenuOpen(false);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-2 gap-2">
        <div ref={menuContainerRef} className="relative flex-1 max-w-sm">
          <button
            type="button"
            onClick={() => setIsMenuOpen((prev) => !prev)}
            className={cn(
              "flex w-full items-center justify-between rounded-md border bg-card px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              isMenuOpen ? "ring-1 ring-ring" : "hover:border-muted",
            )}
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
          >
            <span className="truncate" title={selectedPluginDisplayName}>
              {selectedPluginDisplayName}
            </span>
            <ChevronDown
              className={cn(
                "ml-2 h-4 w-4 flex-shrink-0 transition-transform",
                isMenuOpen && "rotate-180",
              )}
              aria-hidden
            />
          </button>
          {isMenuOpen && (
            <div className="absolute left-0 top-full z-20 mt-2 w-64 rounded-md border bg-card shadow-lg">
              <div className="max-h-64 overflow-y-auto py-1" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className={cn(
                    "w-full truncate px-3 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                    selectedPluginId === null
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                  onClick={() => handleSelectPlugin(null)}
                  title="所有插件"
                >
                  所有插件
                </button>
                {availablePlugins.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    暂无插件输出
                  </div>
                ) : (
                  availablePlugins.map((plugin) => {
                    const displayName = plugin.languageId
                      ? `${plugin.id} (${plugin.languageId})`
                      : plugin.id;
                    const isActive = plugin.id === selectedPluginId;
                    return (
                      <button
                        key={`${plugin.id}::${plugin.languageId || ""}`}
                        type="button"
                        role="menuitem"
                        className={cn(
                          "w-full truncate px-3 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                          isActive
                            ? "bg-muted font-medium text-foreground"
                            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                        )}
                        onClick={() => handleSelectPlugin(plugin.id)}
                        title={displayName}
                      >
                        {displayName}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClear}
          disabled={logs.length === 0}
        >
          清空
        </Button>
      </div>
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-muted/30 px-4 py-3"
      >
        {filteredLogs.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {selectedPluginId
              ? `插件 ${selectedPluginId} 暂无输出。`
              : "当前没有可显示的插件输出。"}
          </p>
        ) : (
          <ul className="space-y-1 text-xs font-mono leading-6">
            {filteredLogs.map((entry) => {
              const timestamp = formatTimestamp(entry.timestamp);
              const pluginLabel = entry.pluginId || "unknown";
              const languageLabel = entry.languageId
                ? `/${entry.languageId}`
                : "";
              const sessionLabel =
                entry.sessionId && entry.sessionId !== "unknown"
                  ? `#${entry.sessionId.slice(0, 8)}`
                  : "";
              const levelClass =
                entry.level === "stderr"
                  ? "text-destructive"
                  : "text-foreground";

              return (
                <li key={entry.id} className="whitespace-pre-wrap break-words">
                  <span className="text-muted-foreground">{timestamp}</span>
                  <span className="text-muted-foreground ml-2">
                    [{pluginLabel}
                    {languageLabel}
                    {sessionLabel}]
                  </span>
                  <span className="ml-2 text-muted-foreground uppercase">
                    {entry.level}
                  </span>
                  <span className={cn("ml-2", levelClass)}>
                    {entry.message && entry.message.length > 0
                      ? entry.message
                      : "(无输出)"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default PluginOutputPanel;
