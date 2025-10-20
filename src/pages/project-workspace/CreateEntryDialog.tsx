import type React from "react";

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

import type { CreateEntryType } from "./types";

type CreateEntryDialogProps = {
  open: boolean;
  activeDirectoryDisplayPath: string;
  entryType: CreateEntryType;
  entryName: string;
  isProcessing: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onTypeChange: (type: CreateEntryType) => void;
  onNameChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
};

export function CreateEntryDialog({
  open,
  activeDirectoryDisplayPath,
  entryType,
  entryName,
  isProcessing,
  error,
  onOpenChange,
  onTypeChange,
  onNameChange,
  onSubmit,
}: CreateEntryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" showCloseButton={!isProcessing}>
        <DialogHeader>
          <DialogTitle>新建文件或文件夹</DialogTitle>
          <DialogDescription>
            将在当前目录{" "}
            <span className="font-medium text-foreground">
              {activeDirectoryDisplayPath}
            </span>
            内创建新条目。
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={onSubmit}>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={entryType === "file" ? "default" : "outline"}
              onClick={() => onTypeChange("file")}
              disabled={isProcessing}
            >
              新建文件
            </Button>
            <Button
              type="button"
              variant={entryType === "folder" ? "default" : "outline"}
              onClick={() => onTypeChange("folder")}
              disabled={isProcessing}
            >
              新建文件夹
            </Button>
          </div>
          <div className="space-y-2">
            <Input
              value={entryName}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder={
                entryType === "file" ? "例如：index.html" : "例如：assets"
              }
              autoFocus
              disabled={isProcessing}
            />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isProcessing}
            >
              取消
            </Button>
            <Button
              type="submit"
              disabled={isProcessing || entryName.trim().length === 0}
            >
              {isProcessing ? "创建中…" : "确认创建"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
