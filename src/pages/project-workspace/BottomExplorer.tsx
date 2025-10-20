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
import type { ColumnId, ColumnState } from "./types";

type Props = {
  isExplorerOpen: boolean;
  setActiveBottomTab: (id: any) => void;
  isLoadingFileTree: boolean;
  isLoadingPreview: boolean;
  toggleExplorer: () => void;
  refreshFileTree: () => void;
  requestPreviewReload: () => void;
  isFilesTab: boolean;
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
};

export function BottomExplorer(props: Props) {
  const {
    isExplorerOpen,
    setActiveBottomTab,
    isLoadingFileTree,
    isLoadingPreview,
    toggleExplorer,
    refreshFileTree,
    requestPreviewReload,
    isFilesTab,
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
        {isExplorerOpen ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-1 rounded-full border bg-muted/60 p-1">
              {/* tabs are controlled from parent; render placeholder buttons via setActiveBottomTab */}
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
                  !isFilesTab
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-pressed={!isFilesTab}
              >
                预览
              </button>
            </div>
            <div className="flex items-center gap-2">
              {isFilesTab ? (
                <Button
                  variant="outline"
                  size="sm"
                  onPointerDown={(e) => e.preventDefault()}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={refreshFileTree}
                  disabled={isLoadingFileTree}
                >
                  {isLoadingFileTree ? "刷新中…" : "刷新"}
                </Button>
              ) : (
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
              )}
              <Button
                variant="ghost"
                size="icon"
                className="flex-shrink-0"
                onClick={toggleExplorer}
              >
                <ChevronDown className="h-5 w-5" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-4">
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
            <Button
              variant="ghost"
              size="icon"
              className="flex-shrink-0"
              onPointerDown={(e) => e.preventDefault()}
              onMouseDown={(e) => e.preventDefault()}
              onClick={toggleExplorer}
            >
              <ChevronUp className="h-5 w-5" />
            </Button>
          </div>
        )}
      </div>
      <div className="relative flex-1 overflow-hidden px-4 pb-5 pt-4">
        {isExplorerOpen && (
          <>
            {isFilesTab ? (
              <div className="flex h-full flex-col overflow-hidden">
                <div className="px-2 pb-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {activeDirectoryDisplayPath}
                  </span>
                </div>
                <div className="flex-1 overflow-hidden px-2">
                  {isLoadingFileTree ? (
                    <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
                      正在读取项目结构…
                    </div>
                  ) : fileTreeError ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                      <p className="text-sm text-destructive">
                        {fileTreeError}
                      </p>
                    </div>
                  ) : fileTree.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
                      <p>项目中尚无文件或目录。</p>
                      <p>使用底部加号即可创建新文件或文件夹。</p>
                    </div>
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
            ) : (
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
            )}
          </>
        )}
      </div>
    </section>
  );
}

export default BottomExplorer;
