export type BottomTabId = "files" | "preview" | "terminal" | "logs";
export type CreateEntryType = "file" | "folder";
export type ColumnId = "left" | "right";

export type ColumnState = {
  directoryPath: string;
  stack: string[];
  lastVisitedChildPath: string | null;
  lastVisitedChildParentPath: string | null;
};

export const BOTTOM_TABS: Array<{ id: BottomTabId; label: string }> = [
  { id: "files", label: "文件管理" },
  { id: "preview", label: "实时预览" },
  { id: "terminal", label: "终端" },
  { id: "logs", label: "插件输出" },
];

export const COLUMN_IDS: ColumnId[] = ["left", "right"];
