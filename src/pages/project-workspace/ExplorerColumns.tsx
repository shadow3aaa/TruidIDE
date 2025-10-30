import type React from "react";
import { Fragment } from "react";

import { ChevronRight, FileText, Folder } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { FileNode } from "@/types/project";

import type { ColumnId, ColumnState } from "./types";
import { normalizeForCompare } from "./fs-utils";

type ColumnComputed = {
  view: ColumnState;
  nodes: FileNode[];
  displayPath: string;
};

type ExplorerColumnsProps = {
  columnOrder: ColumnId[];
  columnComputed: Record<ColumnId, ColumnComputed>;
  activeColumn: ColumnId;
  activeFilePath: string | null;
  normalizedProjectPath: string;
  onColumnFocus: (columnId: ColumnId) => void;
  onGoToParent: (columnId: ColumnId) => void;
  onEntryClick: (
    event: React.MouseEvent<HTMLButtonElement>,
    columnId: ColumnId,
    node: FileNode,
  ) => void;
  onEntryPointerDown: (
    event: React.PointerEvent<HTMLButtonElement>,
    columnId: ColumnId,
    node: FileNode,
  ) => void;
  onEntryPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onEntryContextMenu: (
    event: React.MouseEvent<HTMLButtonElement>,
    columnId: ColumnId,
    node: FileNode,
  ) => void;
  activeDirectoryDisplayPath?: string;
};

export function ExplorerColumns({
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
}: ExplorerColumnsProps) {
  const colCount = columnOrder.length;
  const activeIndex = columnOrder.findIndex((id) => id === activeColumn);
  const overlayLeftPercent =
    colCount > 0 && activeIndex >= 0 ? (activeIndex / colCount) * 100 : 0;
  const overlayWidthPercent = colCount > 0 ? 100 / colCount : 0;

  return (
    <Card className="relative flex-row gap-0 h-full overflow-hidden">
      {/* directory pill */}
      <div className="absolute left-4 top-4 z-10">
        <div className="inline-flex max-w-[36rem] items-center gap-2 px-3 py-1 rounded-md bg-black text-white text-sm font-medium shadow-sm">
          <span className="break-all text-left leading-snug">
            {activeDirectoryDisplayPath}
          </span>
        </div>
      </div>

      {/* column focus overlay */}
      {activeIndex >= 0 && colCount > 0 ? (
        <div
          aria-hidden
          className="absolute top-0 left-0 h-full w-full pointer-events-none"
        >
          <div
            className={cn(
              "absolute top-0 bottom-0 pointer-events-none bg-primary/5",
              activeIndex === 0 ? "rounded-l-xl" : "",
              activeIndex === colCount - 1 ? "rounded-r-xl" : "",
            )}
            style={{
              left: `${overlayLeftPercent}%`,
              width: `${overlayWidthPercent}%`,
            }}
          />
        </div>
      ) : null}

      {columnOrder.map((columnId) => {
        const data = columnComputed[columnId];
        const isColumnActive = activeColumn === columnId;
        const columnView = data.view;
        const columnCanGoUp =
          normalizeForCompare(columnView.directoryPath) !==
            normalizedProjectPath || columnView.stack.length > 0;

        return (
          <Fragment key={columnId}>
            <div
              className={cn(
                "relative z-10 flex min-w-0 flex-1 flex-col gap-2 pt-8 px-0 transition",
                isColumnActive ? "" : "hover:bg-muted/10",
              )}
              onMouseDown={() => onColumnFocus(columnId)}
            >
              <div className="no-scrollbar flex-1 overflow-y-auto overflow-x-hidden px-1">
                <div className="divide-y divide-border">
                  {/* parent (go up) button */}
                  <div
                    className={cn(
                      "relative group -mx-6 px-6",
                      columnCanGoUp ? "" : "opacity-60",
                    )}
                  >
                    {columnCanGoUp ? (
                      <span
                        aria-hidden
                        className="absolute inset-0 rounded-none pointer-events-none transition-colors group-hover:bg-muted group-hover:shadow-sm z-0"
                      />
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        if (!columnCanGoUp) return;
                        onColumnFocus(columnId);
                        onGoToParent(columnId);
                      }}
                      disabled={!columnCanGoUp}
                      className={cn(
                        "relative w-full flex items-start justify-between gap-3 py-3 px-6 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        columnCanGoUp
                          ? ""
                          : "cursor-not-allowed text-muted-foreground",
                      )}
                    >
                      <span className="flex flex-1 items-start gap-3 relative z-10">
                        <Folder
                          className={cn(
                            "h-4 w-4 shrink-0",
                            columnCanGoUp
                              ? "text-primary"
                              : "text-muted-foreground",
                          )}
                          aria-hidden
                        />
                        <span className="break-all text-left font-medium text-foreground leading-snug">
                          ..
                        </span>
                      </span>
                      <ChevronRight
                        className="h-4 w-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    </button>
                  </div>

                  {/* nodes */}
                  {data.nodes.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-muted-foreground">
                      该目录为空
                    </div>
                  ) : (
                    data.nodes.map((node) => {
                      const isActiveFile =
                        node.type === "file" && node.path === activeFilePath;
                      return (
                        <div
                          key={node.path}
                          className="relative group -mx-6 px-6"
                        >
                          {isActiveFile ? (
                            <span
                              aria-hidden
                              className="absolute inset-0 bg-primary/10 shadow-sm rounded-none pointer-events-none transition-colors z-0"
                            />
                          ) : (
                            <span
                              aria-hidden
                              className="absolute inset-0 rounded-none pointer-events-none transition-colors group-hover:bg-muted group-hover:shadow-sm z-0"
                            />
                          )}
                          <button
                            type="button"
                            onClick={(event) =>
                              onEntryClick(event, columnId, node)
                            }
                            onPointerDown={(event) =>
                              onEntryPointerDown(event, columnId, node)
                            }
                            onPointerUp={onEntryPointerUp}
                            onPointerCancel={onEntryPointerUp}
                            onPointerLeave={onEntryPointerUp}
                            onContextMenu={(event) =>
                              onEntryContextMenu(event, columnId, node)
                            }
                          className={cn(
                            "group relative w-full flex items-start justify-between gap-3 py-3 px-6 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            isActiveFile ? "text-primary" : "text-foreground",
                          )}
                          >
                            <span className="flex flex-1 items-start gap-3 relative z-10">
                              {node.type === "folder" ? (
                                <Folder
                                  className="h-4 w-4 shrink-0 text-primary"
                                  aria-hidden
                                />
                              ) : (
                                <FileText
                                  className="h-4 w-4 shrink-0 text-muted-foreground"
                                  aria-hidden
                                />
                              )}
                              <span className="break-all text-left font-medium leading-snug">
                                {node.name}
                              </span>
                            </span>
                            {node.type === "folder" ? (
                              <ChevronRight
                                className="h-4 w-4 shrink-0 text-muted-foreground"
                                aria-hidden
                              />
                            ) : null}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </Fragment>
        );
      })}
    </Card>
  );
}

export default ExplorerColumns;
