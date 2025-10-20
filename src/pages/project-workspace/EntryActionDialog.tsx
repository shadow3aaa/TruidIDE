import type React from "react";

import { ArrowLeft, ArrowRight, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { FileNode } from "@/types/project";

import { getDisplayPath } from "./fs-utils";
import type { ColumnId, ColumnState } from "./types";

type EntryActionContext = { columnId: ColumnId; node: FileNode } | null;

type EntryActionDialogProps = {
  open: boolean;
  context: EntryActionContext;
  pendingAction: "rename" | null;
  isProcessing: boolean;
  error: string | null;
  renameEntryName: string;
  columnViews: Record<ColumnId, ColumnState>;
  projectPath: string;
  onOpenChange: (open: boolean) => void;
  onRenameNameChange: (value: string) => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onSubmitRename: (event: React.FormEvent<HTMLFormElement>) => void;
  onCopyOrMove: (mode: "copy" | "move") => void;
  onDelete: () => void;
};

export function EntryActionDialog({
  open,
  context,
  pendingAction,
  isProcessing,
  error,
  renameEntryName,
  columnViews,
  projectPath,
  onOpenChange,
  onRenameNameChange,
  onStartRename,
  onCancelRename,
  onSubmitRename,
  onCopyOrMove,
  onDelete,
}: EntryActionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" showCloseButton={!isProcessing}>
        {context
          ? (() => {
              const targetColumn: ColumnId =
                context.columnId === "left" ? "right" : "left";
              const targetDirectoryPath =
                columnViews[targetColumn]?.directoryPath ?? projectPath;
              const targetDirectoryDisplay = getDisplayPath(
                targetDirectoryPath,
                projectPath,
              );
              const entryLabel =
                context.node.type === "folder" ? "文件夹" : "文件";

              if (pendingAction === "rename") {
                return (
                  <div className="space-y-5">
                    <DialogHeader className="items-center text-center">
                      <DialogTitle className="text-lg font-semibold">
                        重命名
                      </DialogTitle>
                      <DialogDescription className="text-sm">
                        当前{entryLabel}：
                        <span className="ml-1 font-medium text-foreground">
                          {context.node.name}
                        </span>
                      </DialogDescription>
                    </DialogHeader>
                    <form className="space-y-5" onSubmit={onSubmitRename}>
                      <Input
                        value={renameEntryName}
                        onChange={(event) =>
                          onRenameNameChange(event.target.value)
                        }
                        disabled={isProcessing}
                        autoFocus
                      />
                      {error ? (
                        <p className="text-sm text-destructive">{error}</p>
                      ) : null}
                      <DialogFooter>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={onCancelRename}
                          disabled={isProcessing}
                        >
                          返回
                        </Button>
                        <Button type="submit" disabled={isProcessing}>
                          {isProcessing ? "提交中…" : "确认重命名"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </div>
                );
              }

              return (
                <div className="space-y-5">
                  <DialogHeader className="items-center text-center">
                    <DialogTitle className="text-lg font-semibold">
                      选择操作
                    </DialogTitle>
                    <DialogDescription className="text-sm">
                      {entryLabel}：
                      <span className="ml-1 font-medium text-foreground">
                        {context.node.name}
                      </span>
                    </DialogDescription>
                  </DialogHeader>
                  {error ? (
                    <p className="text-sm text-destructive">{error}</p>
                  ) : null}
                  {(() => {
                    const ArrowIcon =
                      context.columnId === "left" ? ArrowRight : ArrowLeft;
                    const arrowLabel = context.columnId === "left" ? "→" : "←";

                    return (
                      <div className="grid grid-cols-2 gap-3">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={onStartRename}
                          disabled={isProcessing}
                          className="h-20 flex-col items-start justify-center gap-1 rounded-xl border bg-accent/40 px-4 text-left text-sm font-semibold shadow-sm transition hover:bg-accent"
                        >
                          <Pencil className="h-5 w-5 text-muted-foreground" />
                          <span>重命名</span>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => onCopyOrMove("copy")}
                          disabled={isProcessing}
                          className="h-20 flex-col items-start justify-center gap-1 rounded-xl border bg-accent/40 px-4 text-left text-sm font-semibold shadow-sm transition hover:bg-accent"
                        >
                          <ArrowIcon className="h-5 w-5 text-muted-foreground" />
                          <span>复制&nbsp;{arrowLabel}</span>
                          <span className="text-xs font-normal text-muted-foreground">
                            目标：{targetDirectoryDisplay}
                          </span>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => onCopyOrMove("move")}
                          disabled={isProcessing}
                          className="h-20 flex-col items-start justify-center gap-1 rounded-xl border bg-accent/40 px-4 text-left text-sm font-semibold shadow-sm transition hover:bg-accent"
                        >
                          <ArrowIcon className="h-5 w-5 text-muted-foreground" />
                          <span>移动&nbsp;{arrowLabel}</span>
                          <span className="text-xs font-normal text-muted-foreground">
                            目标：{targetDirectoryDisplay}
                          </span>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={onDelete}
                          disabled={isProcessing}
                          className="h-20 flex-col items-start justify-center gap-1 rounded-xl border border-destructive/50 bg-destructive/5 px-4 text-left text-sm font-semibold text-destructive shadow-sm transition hover:bg-destructive/10"
                        >
                          <Trash2 className="h-5 w-5" />
                          <span>删除</span>
                        </Button>
                      </div>
                    );
                  })()}
                </div>
              );
            })()
          : null}
      </DialogContent>
    </Dialog>
  );
}
