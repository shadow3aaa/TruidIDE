import React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Plus,
} from "lucide-react";
import { ExplorerColumns } from "./ExplorerColumns";
import { Card, CardHeader } from "@/components/ui/card";
import type { ColumnId, ColumnState } from "./types";

type Props = {
  isExplorerOpen: boolean;
  setActiveBottomTab: (id: any) => void;
  activeBottomTab: "files" | "preview" | "terminal";
  isLoadingFileTree: boolean;
  isLoadingPreview: boolean;
  toggleExplorer: () => void;
  // refreshFileTree removed from props — file tree is refreshed automatically now
  requestPreviewReload: () => void;
  // isFilesTab removed - use activeBottomTab
  previewUrl: string | null;
  previewError: string | null;
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
};

export function BottomExplorer(props: Props) {
  const {
    isExplorerOpen,
    setActiveBottomTab,
    activeBottomTab,
    isLoadingFileTree,
    isLoadingPreview,
    toggleExplorer,
  // refreshFileTree removed from props — file tree is refreshed automatically now
    requestPreviewReload,
    // isFilesTab removed
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
  } = props;

  const isFilesTab = activeBottomTab === "files";
  const isPreviewTab = activeBottomTab === "preview";
  const isTerminalTab = activeBottomTab === "terminal";
  const TerminalTabLazy = React.lazy(() => import("@/components/TerminalTab"));

  return (
    <section
      className={cn(
        // When expanded: fixed full-height overlay; when collapsed: participate in layout (not fixed)
        isExplorerOpen
          ? "fixed inset-x-0 bottom-0 z-40 flex flex-col border-t border-border/60 bg-background/95 shadow-lg transition-[height] duration-300 ease-out supports-[backdrop-filter]:bg-background/70 overflow-hidden h-full"
          : "relative z-10 flex flex-col border-t border-border/60 bg-background/95 shadow-none transition-[height] duration-300 ease-out overflow-visible max-h-[96px] sm:max-h-[56px]",
      )}
      aria-expanded={isExplorerOpen}
    >
      <div className="flex flex-col px-4 pt-2 pb-2">
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
                </div>

                {/* right: preview action + collapse button */}
                <div className="ml-auto flex items-center gap-2">
                  {isPreviewTab ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onPointerDown={(e) => e.preventDefault()}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={requestPreviewReload}
                      disabled={isLoadingPreview}
                    >
                      {isLoadingPreview ? "加载中…" : "刷新预览"}
                    </Button>
                  ) : null}
                  <button
                    type="button"
                    onPointerDown={(e) => e.preventDefault()}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={toggleExplorer}
                    className={cn(
                      "inline-flex items-center justify-center rounded-full p-1",
                      "text-muted-foreground hover:bg-muted/10",
                    )}
                    aria-label={isExplorerOpen ? "收起底部面板" : "展开底部面板"}
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
          <div className="flex items-start justify-between gap-4 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              {[
                "[",
                "]",
                "{",
                "}",
                "(",
                ")",
                "<",
                ">",
                "=",
                "+",
                "-",
                "*",
                "/",
              ].map((key) => (
                <Button
                  key={key}
                  variant="outline"
                  size="sm"
                  className="px-3"
                  onPointerDown={(e) => e.preventDefault()}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => props.insertTextAtCursor?.(key)}
                >
                  {key}
                </Button>
              ))}
            </div>
            <div className="flex items-center">
              <Button
                variant="ghost"
                size="icon"
                className="flex-shrink-0"
                onPointerDown={(e) => e.preventDefault()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={toggleExplorer}
                aria-label="展开底部面板"
              >
                <ChevronUp className="h-5 w-5" />
              </Button>
            </div>
          </div>
        ) : null}
      </div>
  <div className="relative flex-1 overflow-hidden px-4 pb-5 pt-2">
        {isExplorerOpen && (
          <>
            {isFilesTab ? (
              <div className="flex h-full flex-col overflow-hidden">
                <div className="flex-1 overflow-hidden px-0">
                  {isLoadingFileTree && fileTree.length === 0 ? (
                    <Card className="h-full">
                      <CardHeader className="px-4 pt-3 pb-0">
                        <div className="inline-flex max-w-[36rem] items-center gap-2 truncate px-3 py-1 rounded-md bg-black text-white text-sm font-medium shadow-sm">
                          <span className="truncate">{activeDirectoryDisplayPath}</span>
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
                          <span className="truncate">{activeDirectoryDisplayPath}</span>
                        </div>
                      </CardHeader>
                      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                        <p className="text-sm text-destructive">{fileTreeError}</p>
                      </div>
                    </Card>
                  ) : fileTree.length === 0 ? (
                    <Card className="h-full">
                      <CardHeader className="px-4 pt-3 pb-0">
                        <div className="inline-flex max-w-[36rem] items-center gap-2 truncate px-3 py-1 rounded-md bg-black text-white text-sm font-medium shadow-sm">
                          <span className="truncate">{activeDirectoryDisplayPath}</span>
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
                {isLoadingPreview ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
                    <p>正在生成预览…</p>
                    <p>请稍候，预览加载完成后会自动刷新。</p>
                  </div>
                ) : props.previewError ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
                    <p className="text-sm text-destructive">
                      {props.previewError}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={requestPreviewReload}
                    >
                      重试
                    </Button>
                  </div>
                ) : props.previewUrl ? (
                  <iframe
                    key={props.previewUrl}
                    src={props.previewUrl}
                    title="项目实时预览"
                    className="h-full w-full border-0 bg-background"
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
                    <p>选择下方的“刷新预览”以加载项目效果。</p>
                    <p>
                      若项目尚未生成入口文件，请在项目目录中提供 index.html。
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full overflow-hidden rounded-xl border bg-card shadow-sm">
                <React.Suspense fallback={<div className="p-4">正在加载终端…</div>}>
                  <TerminalTabLazy projectPath={props.projectPath} />
                </React.Suspense>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export default BottomExplorer;
