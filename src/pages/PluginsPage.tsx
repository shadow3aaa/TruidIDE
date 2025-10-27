import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { importPlugin, listPlugins, removePlugin } from "@/lib/plugins";
import type { PluginSummary } from "@/types/plugin";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type PluginStatus = "idle" | "loading" | "ready" | "error";

function PluginsPage() {
  const navigate = useNavigate();
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [status, setStatus] = useState<PluginStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setImporting] = useState(false);
  const [isActionDialogOpen, setActionDialogOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isRemovingPlugin, setRemovingPlugin] = useState(false);
  const [pluginActionTarget, setPluginActionTarget] =
    useState<PluginSummary | null>(null);

  const pluginLongPressTimerRef = useRef<number | null>(null);
  const pluginLongPressTriggeredRef = useRef(false);

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/");
    }
  };

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);

    listPlugins()
      .then((result) => {
        if (cancelled) {
          return;
        }
        setPlugins(result);
        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }

        const message =
          typeof err === "string"
            ? err
            : err instanceof Error
              ? err.message
              : "加载插件列表失败";
        setError(message);
        setStatus("error");
      });

    let unlisten: (() => void) | undefined;
    if (typeof window !== "undefined") {
      listen<PluginSummary[]>("truidide://plugins/updated", (event) => {
        if (cancelled) {
          return;
        }
        const payload = event.payload;
        if (Array.isArray(payload)) {
          setPlugins(payload);
          setStatus("ready");
        }
      })
        .then((dispose) => {
          unlisten = dispose;
        })
        .catch(() => {
          // 浏览器环境中忽略事件订阅失败
        });
    }

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  const cancelPluginLongPress = useCallback(() => {
    if (pluginLongPressTimerRef.current !== null) {
      window.clearTimeout(pluginLongPressTimerRef.current);
      pluginLongPressTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => cancelPluginLongPress();
  }, [cancelPluginLongPress]);

  const openPluginActionDialog = useCallback((plugin: PluginSummary) => {
    setPluginActionTarget(plugin);
    setActionError(null);
    setActionDialogOpen(true);
  }, []);

  const closePluginActionDialog = useCallback(() => {
    if (isRemovingPlugin) {
      return;
    }
    setActionDialogOpen(false);
    setActionError(null);
    setPluginActionTarget(null);
  }, [isRemovingPlugin]);

  const handleImport = async () => {
    if (isImporting) {
      return;
    }

    try {
      const selection = await open({
        directory: false,
        multiple: false,
        title: "选择插件包",
        filters: [
          {
            name: "TruidIDE 插件",
            extensions: ["zip"],
          },
        ],
      });

      const sourcePath = Array.isArray(selection) ? selection[0] : selection;
      if (typeof sourcePath !== "string" || sourcePath.length === 0) {
        return;
      }

      setImporting(true);
      setError(null);

      const imported = await importPlugin(sourcePath);
      setPlugins((prev) => {
        const exists = prev.some((plugin) => plugin.id === imported.id);
        if (exists) {
          return prev.map((plugin) =>
            plugin.id === imported.id ? imported : plugin,
          );
        }
        return [...prev, imported];
      });
      setStatus("ready");
    } catch (err) {
      const message =
        typeof err === "string"
          ? err
          : err instanceof Error
            ? err.message
            : "导入插件失败";
      setError(message);
      setStatus("error");
    } finally {
      setImporting(false);
    }
  };

  const handlePluginPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, plugin: PluginSummary) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      cancelPluginLongPress();
      pluginLongPressTriggeredRef.current = false;
      pluginLongPressTimerRef.current = window.setTimeout(() => {
        pluginLongPressTriggeredRef.current = true;
        openPluginActionDialog(plugin);
      }, 450);
    },
    [cancelPluginLongPress, openPluginActionDialog],
  );

  const handlePluginPointerUp = useCallback(() => {
    cancelPluginLongPress();
  }, [cancelPluginLongPress]);

  const handlePluginContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>, plugin: PluginSummary) => {
      event.preventDefault();
      cancelPluginLongPress();
      pluginLongPressTriggeredRef.current = false;
      openPluginActionDialog(plugin);
    },
    [cancelPluginLongPress, openPluginActionDialog],
  );

  const handleConfirmRemove = useCallback(async () => {
    if (!pluginActionTarget) {
      return;
    }

    if (pluginActionTarget.location === "builtIn") {
      setActionError("内置插件暂不支持删除");
      return;
    }

    setRemovingPlugin(true);
    setActionError(null);
    try {
      const nextPlugins = await removePlugin(pluginActionTarget.id);
      setPlugins(nextPlugins);
      setActionDialogOpen(false);
      setPluginActionTarget(null);
    } catch (err) {
      const message =
        typeof err === "string"
          ? err
          : err instanceof Error
            ? err.message
            : "删除插件失败";
      setActionError(message);
    } finally {
      setRemovingPlugin(false);
    }
  }, [pluginActionTarget]);

  const sortedPlugins = useMemo(() => {
    return [...plugins].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }, [plugins]);

  return (
    <main
      className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-6 py-10"
      style={{
        paddingTop: "var(--safe-area-inset-top, 0)",
        paddingBottom: "var(--safe-area-inset-bottom, 0)",
      }}
    >
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">扩展能力中心</p>
          <h1 className="text-2xl font-semibold tracking-tight">插件管理</h1>
        </div>
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" onClick={handleBack}>
            返回
          </Button>
          <Button type="button" onClick={handleImport} disabled={isImporting}>
            {isImporting ? "导入中…" : "导入插件"}
          </Button>
        </div>
      </header>

      {status === "loading" && (
        <p className="text-sm text-muted-foreground">正在加载可用插件…</p>
      )}

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {sortedPlugins.length === 0 && status === "ready" ? (
        <p className="text-sm text-muted-foreground">
          暂未检测到任何插件。请点击右上角“导入插件”并选择包装有
          truid-plugin.json 的 ZIP 文件完成导入。
        </p>
      ) : (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {sortedPlugins.map((plugin) => {
            const kindType = plugin.kind?.type ?? "unknown";
            const languageIds =
              plugin.kind?.type === "lsp" &&
              Array.isArray(plugin.kind.languageIds)
                ? plugin.kind.languageIds
                : [];
            const tags = Array.isArray(plugin.tags) ? plugin.tags : [];
            const enabled =
              typeof plugin.enabled === "boolean" ? plugin.enabled : true;

            return (
              <Card
                key={plugin.id}
                onPointerDown={(event) =>
                  handlePluginPointerDown(event, plugin)
                }
                onPointerUp={handlePluginPointerUp}
                onPointerLeave={cancelPluginLongPress}
                onPointerCancel={cancelPluginLongPress}
                onContextMenu={(event) =>
                  handlePluginContextMenu(event, plugin)
                }
              >
                <CardHeader className="border-b pb-6">
                  <CardTitle className="text-base">
                    {plugin.name}
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      v{plugin.version}
                    </span>
                  </CardTitle>
                  <CardDescription>
                    {plugin.description ?? "暂无描述"}
                  </CardDescription>
                  <CardAction>
                    <span className="inline-flex items-center rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                      {plugin.location === "builtIn" ? "内置" : "用户"}
                    </span>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm text-muted-foreground">
                    <dt>标识</dt>
                    <dd className="text-foreground">{plugin.id}</dd>
                    <dt>作者</dt>
                    <dd>{plugin.author ?? "未知"}</dd>
                    <dt>状态</dt>
                    <dd className="text-foreground">
                      {enabled ? "已启用" : "已禁用"}
                    </dd>
                    <dt>类型</dt>
                    <dd className="text-foreground">
                      {kindType === "lsp" ? "语言服务" : kindType}
                    </dd>
                    {kindType === "lsp" && (
                      <>
                        <dt>语言</dt>
                        <dd className="text-foreground">
                          {languageIds.length > 0
                            ? languageIds.join(", ")
                            : "未声明"}
                        </dd>
                      </>
                    )}
                    <dt>标签</dt>
                    <dd className="text-foreground">
                      {tags.length > 0 ? tags.join(", ") : "无"}
                    </dd>
                  </dl>
                  {tags.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </section>
      )}
      <Dialog
        open={isActionDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            closePluginActionDialog();
          } else if (pluginActionTarget) {
            setActionDialogOpen(true);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除插件</DialogTitle>
            <DialogDescription>
              {pluginActionTarget
                ? `确定要删除插件 ${pluginActionTarget.name} (${pluginActionTarget.id}) 吗？`
                : "确定要删除选中的插件吗？"}
            </DialogDescription>
          </DialogHeader>
          {pluginActionTarget?.location === "builtIn" && (
            <p className="text-sm text-muted-foreground">
              内置插件暂不支持删除。
            </p>
          )}
          {actionError && (
            <p className="text-sm text-destructive">{actionError}</p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={closePluginActionDialog}
              disabled={isRemovingPlugin}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirmRemove}
              disabled={
                isRemovingPlugin || pluginActionTarget?.location === "builtIn"
              }
            >
              {isRemovingPlugin ? "正在删除…" : "删除插件"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

export default PluginsPage;
