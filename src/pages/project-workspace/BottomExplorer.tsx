import React from "react";
import Lottie from "lottie-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Plus,
  RefreshCcw,
  Info,
} from "lucide-react";
import { ExplorerColumns } from "./ExplorerColumns";
import { Card, CardHeader } from "@/components/ui/card";
import type { ColumnId, ColumnState, BottomTabId } from "./types";
import type { PluginLogEntry } from "./PluginOutputPanel";
import { PluginOutputPanel } from "./PluginOutputPanel";
import waitingAnimation from "@/assets/cat.json";

type Props = {
  isExplorerOpen: boolean;
  setActiveBottomTab: (id: BottomTabId) => void;
  activeBottomTab: BottomTabId;
  isLoadingFileTree: boolean;
  toggleExplorer: () => void;
  previewAddressInput: string;
  onPreviewAddressInputChange: (value: string) => void;
  onApplyPreviewAddress: () => void;
  previewAddressError: string | null;
  previewResolvedBaseUrl: string | null;
  previewResolvedUrl: string | null;
  canReloadPreview: boolean;
  previewStatus: "idle" | "validating" | "ready" | "offline";
  requestPreviewReload: () => void;
  onPreviewFrameLoaded: () => void;
  onPreviewFrameError: () => void;
  columnOrder: ColumnId[];
  columnComputed: Record<
    ColumnId,
    { view: ColumnState; nodes: any[]; displayPath: string }
  >;
  activeColumn: ColumnId;
  activeFilePath: string | null;
  normalizedProjectPath: string;
  onColumnFocus: (id: ColumnId) => void;
  onGoToParent: (id: ColumnId) => void;
  onEntryClick: any;
  onEntryPointerDown: any;
  onEntryPointerUp: any;
  onEntryContextMenu: any;
  activeDirectoryDisplayPath: string;
  canGoToParent: boolean;
  canGoToLastVisitedChild: boolean;
  goToParentDirectory: () => void;
  goToLastVisitedChildDirectory: () => void;
  openCreateEntryDialog: () => void;
  handleSwapColumns: () => void;
  fileTree: any[];
  fileTreeError: string | null;
  insertTextAtCursor?: (text: string) => void;
  projectPath: string;
  pluginLogs: PluginLogEntry[];
  onClearPluginLogs: () => void;
};

export function BottomExplorer(props: Props) {
  const {
    isExplorerOpen,
    setActiveBottomTab,
    activeBottomTab,
    isLoadingFileTree,
    toggleExplorer,
    previewAddressInput,
    onPreviewAddressInputChange,
    onApplyPreviewAddress,
    previewAddressError,
    previewResolvedBaseUrl,
    previewResolvedUrl,
    canReloadPreview,
    previewStatus,
    requestPreviewReload,
    onPreviewFrameLoaded,
    onPreviewFrameError,
    columnOrder,
    columnComputed,
    activeColumn,
    activeFilePath,
    normalizedProjectPath,
    onColumnFocus,
    onGoToParent,
    onEntryClick,
    onEntryPointerDown,
    onEntryPointerUp,
    onEntryContextMenu,
    activeDirectoryDisplayPath,
    canGoToParent,
    canGoToLastVisitedChild,
    goToParentDirectory,
    goToLastVisitedChildDirectory,
    openCreateEntryDialog,
    handleSwapColumns,
    fileTree,
    fileTreeError,
    pluginLogs,
    onClearPluginLogs,
  } = props;

  const isFilesTab = activeBottomTab === "files";
  const isPreviewTab = activeBottomTab === "preview";
  const isTerminalTab = activeBottomTab === "terminal";
  const isLogsTab = activeBottomTab === "logs";
  const TerminalTabLazy = React.lazy(() => import("@/components/TerminalTab"));
  const [isHelpOpen, setIsHelpOpen] = React.useState(false);

  React.useEffect(() => {
    if (!isExplorerOpen || !isPreviewTab) {
      setIsHelpOpen(false);
    }
  }, [isExplorerOpen, isPreviewTab]);

  const previewOverlayMessage = React.useMemo(() => {
    switch (previewStatus) {
      case "validating":
        return "正在尝试连接开发服务器…";
      case "offline":
        return "未检测到运行中的开发服务器";
      case "idle":
      default:
        return "填写端口或地址以加载预览";
    }
  }, [previewStatus]);

  return (
    <section
      className={cn(
        // When expanded: fixed full-height overlay; when collapsed: participate in layout (not fixed)
        isExplorerOpen
          ? "fixed inset-x-0 bottom-0 z-40 flex flex-col border-t border-border/60 bg-background/95 shadow-lg transition-[height] duration-300 ease-out supports-[backdrop-filter]:bg-background/70 overflow-hidden h-full"
          : "relative z-10 flex flex-col border-t border-border/60 bg-background/95 shadow-none transition-[height] duration-300 ease-out overflow-visible",
      )}
      style={
        isExplorerOpen
          ? {
              paddingTop: "var(--safe-area-inset-top, 0)",
              paddingBottom: "var(--safe-area-inset-bottom, 0)",
            }
          : {
              paddingBottom: "var(--safe-area-inset-bottom, 0)",
            }
      }
      aria-expanded={isExplorerOpen}
    >
      <div
        className={cn(
          "flex flex-col",
          isExplorerOpen ? "px-4 pt-2 pb-2" : "px-0 py-0",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          {isExplorerOpen ? (
            <div className="flex items-center gap-2 w-full">
              <div className="flex items-center gap-1 rounded-full border bg-muted/60 p-1 w-full">
                {/* left: tab buttons */}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onPointerDown={(e) => e.preventDefault()}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setActiveBottomTab("files")}
                    className={cn(
                      "rounded-full px-3 py-1 text-sm font-medium transition",
                      isFilesTab
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    aria-pressed={isFilesTab}
                  >
                    文件
                  </button>
                  <button
                    type="button"
                    onPointerDown={(e) => e.preventDefault()}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setActiveBottomTab("preview")}
                    className={cn(
                      "rounded-full px-3 py-1 text-sm font-medium transition",
                      isPreviewTab
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    aria-pressed={isPreviewTab}
                  >
                    预览
                  </button>
                  <button
                    type="button"
                    onPointerDown={(e) => e.preventDefault()}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setActiveBottomTab("terminal")}
                    className={cn(
                      "rounded-full px-3 py-1 text-sm font-medium transition",
                      isTerminalTab
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    aria-pressed={isTerminalTab}
                  >
                    终端
                  </button>
                  <button
                    type="button"
                    onPointerDown={(e) => e.preventDefault()}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setActiveBottomTab("logs")}
                    className={cn(
                      "rounded-full px-3 py-1 text-sm font-medium transition",
                      isLogsTab
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    aria-pressed={isLogsTab}
                  >
                    输出
                  </button>
                </div>

                {/* right: collapse button */}
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onPointerDown={(e) => e.preventDefault()}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={toggleExplorer}
                    className={cn(
                      "inline-flex items-center justify-center rounded-full p-1",
                      "text-muted-foreground hover:bg-muted/10",
                    )}
                    aria-label={
                      isExplorerOpen ? "收起底部面板" : "展开底部面板"
                    }
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div />
          )}
        </div>

        {/* Collapsed-only quick keys row */}
        {!isExplorerOpen ? (
          <div className="flex items-center justify-center w-full">
            <div className="flex-1 select-none">
              <div className="flex flex-col items-center w-full p-0 m-0 gap-0">
                {[
                  [
                    { type: "key", value: "[" },
                    { type: "key", value: "]" },
                    { type: "key", value: "{" },
                    { type: "key", value: "}" },
                    { type: "key", value: "(" },
                    { type: "key", value: ")" },
                    { type: "key", value: "<" },
                    { type: "key", value: ">" },
                  ],
                  [
                    { type: "key", value: "=" },
                    { type: "key", value: "+" },
                    { type: "key", value: "-" },
                    { type: "key", value: "*" },
                    { type: "key", value: "/" },
                    { type: "key", value: "_" },
                    { type: "key", value: ":" },
                    { type: "action", value: "expand" },
                  ],
                ].map((row, rowIdx) => (
                  <div
                    key={rowIdx}
                    className="flex flex-row w-full p-0 m-0 gap-0"
                    style={{ borderSpacing: 0 }}
                  >
                    {row.map((item, itemIdx) => {
                      const key = `${rowIdx}-${itemIdx}`;
                      const baseClass =
                        "truid-termux-key flex-1 flex items-center justify-center h-6 m-0 bg-white text-[11px] font-medium select-none transition active:scale-95 cursor-pointer";

                      if (item.type === "action" && item.value === "expand") {
                        return (
                          <div
                            key={key}
                            className={cn(baseClass, "truid-expand-key")}
                            tabIndex={0}
                            role="button"
                            aria-label="展开底部面板"
                            title="展开底部面板"
                            onPointerDown={(e) => e.preventDefault()}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={toggleExplorer}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                toggleExplorer();
                              }
                            }}
                            style={{ minWidth: 0 }}
                          >
                            <ChevronUp className="h-5 w-5" />
                          </div>
                        );
                      }

                      const handleClick = () => {
                        props.insertTextAtCursor?.(item.value);
                      };
                      return (
                        <div
                          key={key}
                          className={cn(baseClass)}
                          tabIndex={0}
                          role="button"
                          aria-label={item.value}
                          title={item.value}
                          onPointerDown={(e) => e.preventDefault()}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={handleClick}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              handleClick();
                            }
                          }}
                          style={{ minWidth: 0 }}
                        >
                          {item.value}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            <style>{`
              .truid-termux-key {
                background: #fff;
                border: none;
                border-radius: 0;
                box-shadow: none;
                margin: 0;
                user-select: none;
                touch-action: manipulation;
                transition: background 0.15s, color 0.15s, transform 0.1s;
                min-width: 0;
                min-height: 24px;
                font-size: 11px;
                letter-spacing: 0.01em;
                font-family: inherit;
                font-weight: 500;
                text-align: center;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 0;
                color: #222;
              }
              .truid-termux-key:active {
                background: #f3f3f3;
                transform: scale(0.97);
              }
              .truid-termux-key-active {
                background: #111 !important;
                color: #fff !important;
              }
              /* 区分展开按钮样式：黑底白字 */
              .truid-expand-key {
                background: #000;
                color: #fff;
              }
              .truid-expand-key:active {
                background: #111;
                transform: scale(0.97);
              }
            `}</style>
          </div>
        ) : null}
      </div>
      {isExplorerOpen && (
        <div className="relative flex-1 overflow-hidden px-4 pb-5 pt-2">
          <>
            {isFilesTab ? (
              <div className="flex h-full flex-col overflow-hidden">
                <div className="flex-1 overflow-hidden px-0">
                  {isLoadingFileTree && fileTree.length === 0 ? (
                    <Card className="h-full">
                      <CardHeader className="px-4 pt-3 pb-0">
                        <div className="inline-flex max-w-[36rem] items-center gap-2 truncate px-3 py-1 rounded-md bg-black text-white text-sm font-medium shadow-sm">
                          <span className="truncate">
                            {activeDirectoryDisplayPath}
                          </span>
                        </div>
                      </CardHeader>
                      <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
                        正在读取项目结构…
                      </div>
                    </Card>
                  ) : fileTreeError ? (
                    <Card className="h-full">
                      <CardHeader className="px-4 pt-3 pb-0">
                        <div className="inline-flex max-w-[36rem] items-center gap-2 truncate px-3 py-1 rounded-md bg-black text-white text-sm font-medium shadow-sm">
                          <span className="truncate">
                            {activeDirectoryDisplayPath}
                          </span>
                        </div>
                      </CardHeader>
                      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                        <p className="text-sm text-destructive">
                          {fileTreeError}
                        </p>
                      </div>
                    </Card>
                  ) : fileTree.length === 0 ? (
                    <Card className="h-full">
                      <CardHeader className="px-4 pt-3 pb-0">
                        <div className="inline-flex max-w-[36rem] items-center gap-2 truncate px-3 py-1 rounded-md bg-black text-white text-sm font-medium shadow-sm">
                          <span className="truncate">
                            {activeDirectoryDisplayPath}
                          </span>
                        </div>
                      </CardHeader>
                      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
                        <p>项目中尚无文件或目录。</p>
                        <p>使用底部加号即可创建新文件或文件夹。</p>
                      </div>
                    </Card>
                  ) : (
                    <ExplorerColumns
                      columnOrder={columnOrder}
                      columnComputed={columnComputed}
                      activeColumn={activeColumn}
                      activeFilePath={activeFilePath}
                      normalizedProjectPath={normalizedProjectPath}
                      onColumnFocus={onColumnFocus}
                      onGoToParent={onGoToParent}
                      onEntryClick={onEntryClick}
                      onEntryPointerDown={onEntryPointerDown}
                      onEntryPointerUp={onEntryPointerUp}
                      onEntryContextMenu={onEntryContextMenu}
                      activeDirectoryDisplayPath={activeDirectoryDisplayPath}
                    />
                  )}
                </div>
                <div className="px-2 pt-2">
                  <div className="flex items-center justify-around">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onPointerDown={(e) => e.preventDefault()}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={goToParentDirectory}
                      disabled={!canGoToParent}
                      aria-label="返回父目录"
                    >
                      <ArrowLeft className="h-5 w-5" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onPointerDown={(e) => e.preventDefault()}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={goToLastVisitedChildDirectory}
                      disabled={!canGoToLastVisitedChild}
                      aria-label="前往上次访问的子目录"
                    >
                      <ArrowRight className="h-5 w-5" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onPointerDown={(e) => e.preventDefault()}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={openCreateEntryDialog}
                      aria-label="新建文件或文件夹"
                    >
                      <Plus className="h-5 w-5" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onPointerDown={(e) => e.preventDefault()}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={handleSwapColumns}
                      aria-label="交换左右文件栏"
                    >
                      <ArrowLeftRight className="h-5 w-5" aria-hidden />
                    </Button>
                  </div>
                </div>
              </div>
            ) : isPreviewTab ? (
              <div className="h-full overflow-hidden rounded-xl border bg-card shadow-sm">
                <div className="flex h-full flex-col">
                  <div className="border-b border-border/60 px-6 py-4">
                    <form
                      className="flex flex-col gap-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        onApplyPreviewAddress();
                      }}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <label
                          className="sr-only"
                          htmlFor="preview-address-input"
                        >
                          预览端口或完整地址
                        </label>
                        <div className="flex min-w-0 flex-1 gap-2">
                          <Input
                            id="preview-address-input"
                            value={previewAddressInput}
                            onChange={(event) =>
                              onPreviewAddressInputChange(event.target.value)
                            }
                            placeholder="例如 5173 或 http://localhost:5173"
                            autoComplete="off"
                            aria-invalid={
                              previewAddressError ? true : undefined
                            }
                          />
                          <Button
                            type="submit"
                            className="whitespace-nowrap"
                            disabled={previewStatus === "validating"}
                          >
                            {canReloadPreview ? "更新" : "加载"}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={requestPreviewReload}
                            disabled={!canReloadPreview}
                            title="刷新预览"
                            aria-label="刷新预览"
                          >
                            <RefreshCcw className="h-4 w-4" aria-hidden />
                          </Button>
                        </div>
                        <div
                          className="relative"
                          onMouseEnter={() => setIsHelpOpen(true)}
                          onMouseLeave={() => setIsHelpOpen(false)}
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setIsHelpOpen((open) => !open)}
                            onFocus={() => setIsHelpOpen(true)}
                            onBlur={() => setIsHelpOpen(false)}
                            title="预览面板使用帮助"
                          >
                            <Info className="h-4 w-4" aria-hidden />
                            <span className="sr-only">预览面板帮助</span>
                          </Button>
                          {isHelpOpen ? (
                            <div className="absolute right-0 z-20 mt-2 w-64 rounded-md border bg-popover px-4 py-3 text-xs text-muted-foreground shadow-lg">
                              <p className="font-medium text-foreground">
                                如何使用预览
                              </p>
                              <ul className="mt-2 list-disc space-y-1 pl-4">
                                <li>
                                  先在“终端”标签中运行开发服务器（如{" "}
                                  <span className="font-mono">npm run dev</span>
                                  ）。
                                </li>
                                <li>输入端口号或完整地址，点击“加载”应用。</li>
                                <li>右侧刷新按钮可强制重新加载预览。</li>
                              </ul>
                            </div>
                          ) : null}
                        </div>
                      </div>
                      {previewAddressError ? (
                        <p className="text-sm text-destructive" role="alert">
                          {previewAddressError}
                        </p>
                      ) : previewResolvedBaseUrl ? (
                        <p className="text-xs text-muted-foreground">
                          当前目标：
                          <span className="ml-1 font-mono">
                            {previewResolvedBaseUrl}
                          </span>
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          输入端口或地址后即可开启预览。
                        </p>
                      )}
                    </form>
                  </div>
                  <div className="relative flex-1 bg-background">
                    {previewResolvedUrl ? (
                      <iframe
                        key={previewResolvedUrl}
                        src={previewResolvedUrl}
                        title="项目实时预览"
                        className={cn(
                          "h-full w-full border-0 bg-background transition-opacity duration-200",
                          previewStatus === "ready"
                            ? "opacity-100"
                            : "opacity-0 pointer-events-none",
                        )}
                        allow="clipboard-read; clipboard-write"
                        onLoad={onPreviewFrameLoaded}
                        onError={onPreviewFrameError}
                      />
                    ) : null}
                    {previewStatus !== "ready" || !previewResolvedUrl ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-4 text-center">
                        <Lottie
                          animationData={waitingAnimation}
                          className="h-48 w-48 max-w-full"
                          autoplay
                          loop
                        />
                        <div className="space-y-2 text-sm text-muted-foreground">
                          <p>{previewOverlayMessage}</p>
                          {previewStatus === "offline" ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={requestPreviewReload}
                            >
                              再试一次
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : isTerminalTab ? (
              <div className="h-full overflow-hidden rounded-xl border bg-card shadow-sm">
                <React.Suspense
                  fallback={<div className="p-4">正在加载终端…</div>}
                >
                  <TerminalTabLazy projectPath={props.projectPath} />
                </React.Suspense>
              </div>
            ) : (
              <div className="h-full overflow-hidden rounded-xl border bg-card shadow-sm">
                <PluginOutputPanel
                  logs={pluginLogs}
                  onClear={onClearPluginLogs}
                />
              </div>
            )}
          </>
        </div>
      )}
    </section>
  );
}

export default BottomExplorer;
