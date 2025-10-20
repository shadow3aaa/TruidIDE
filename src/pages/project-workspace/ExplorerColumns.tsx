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
}: ExplorerColumnsProps) {
  return (
    <Card className="flex-row gap-0 h-full overflow-hidden">
      {columnOrder.map((columnId, index) => {
        const data = columnComputed[columnId];
        const isColumnActive = activeColumn === columnId;
        const columnView = data.view;
        const columnCanGoUp =
          normalizeForCompare(columnView.directoryPath) !==
            normalizedProjectPath || columnView.stack.length > 0;

        return (
          <Fragment key={columnId}>
            {index > 0 ? <div className="w-px bg-border" /> : null}
            <div
              className={cn(
                "flex min-w-0 flex-1 flex-col gap-2 py-3 px-4 transition",
                isColumnActive ? "bg-primary/5" : "hover:bg-muted/10",
              )}
              onMouseDown={() => onColumnFocus(columnId)}
            >
              <div className="no-scrollbar flex-1 overflow-y-auto">
                <div className="divide-y divide-border">
                  <button
                    type="button"
                    onClick={() => {
                      if (!columnCanGoUp) {
                        return;
                      }
                      onColumnFocus(columnId);
                      onGoToParent(columnId);
                    }}
                    disabled={!columnCanGoUp}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 pr-3 pl-0 py-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      columnCanGoUp
                        ? "hover:bg-muted"
                        : "cursor-not-allowed text-muted-foreground opacity-60",
                    )}
                  >
                    <span className="flex flex-1 items-center gap-3">
                      <Folder
                        className={cn(
                          "h-4 w-4",
                          columnCanGoUp
                            ? "text-primary"
                            : "text-muted-foreground",
                        )}
                        aria-hidden
                      />
                      <span className="truncate font-medium text-foreground">
                        ..
                      </span>
                    </span>
                    <ChevronRight
                      className="h-4 w-4 text-muted-foreground"
                      aria-hidden
                    />
                  </button>
                  {data.nodes.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-muted-foreground">
                      该目录为空
                    </div>
                  ) : (
                    data.nodes.map((node) => {
                      const isActiveFile =
                        node.type === "file" && node.path === activeFilePath;
                      return (
                        <button
                          key={node.path}
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
                            "flex w-full items-center justify-between gap-3 pr-3 pl-0 py-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            isActiveFile
                              ? "bg-primary/10 text-primary"
                              : "hover:bg-muted",
                          )}
                        >
                          <span className="flex flex-1 items-center gap-3">
                            {node.type === "folder" ? (
                              <Folder
                                className="h-4 w-4 text-primary"
                                aria-hidden
                              />
                            ) : (
                              <FileText
                                className="h-4 w-4 text-muted-foreground"
                                aria-hidden
                              />
                            )}
                            <span className="truncate font-medium text-foreground">
                              {node.name}
                            </span>
                          </span>
                          {node.type === "folder" ? (
                            <ChevronRight
                              className="h-4 w-4 text-muted-foreground"
                              aria-hidden
                            />
                          ) : null}
                        </button>
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
