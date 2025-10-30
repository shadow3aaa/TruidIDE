import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { FileNode } from "@/types/project";
import { ExplorerColumns } from "@/pages/project-workspace/ExplorerColumns";
import {
  COLUMN_IDS,
  type ColumnId,
  type ColumnState,
} from "@/pages/project-workspace/types";
import {
  createColumnState,
  getDirectoryEntries,
  getDisplayPath,
  normalizeForCompare,
} from "@/pages/project-workspace/fs-utils";

type ProjectPreviewExplorerProps = {
  projectPath: string;
  selectedDirectoryPath: string | null;
  onSelectDirectory: (path: string) => void;
};

export function ProjectPreviewExplorer({
  projectPath,
  selectedDirectoryPath,
  onSelectDirectory,
}: ProjectPreviewExplorerProps) {
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [columnViews, setColumnViews] = useState<Record<ColumnId, ColumnState>>(
    () => ({
      left: createColumnState(projectPath),
      right: createColumnState(projectPath),
    }),
  );
  const [activeColumn, setActiveColumn] = useState<ColumnId>("left");
  const lastSelectedRef = useRef<string | null>(null);

  const normalizedProjectPath = useMemo(
    () => normalizeForCompare(projectPath),
    [projectPath],
  );
  const columnOrder = useMemo(() => COLUMN_IDS, []);

  useEffect(() => {
    if (!projectPath) {
      setFileTree([]);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    invoke<FileNode[]>("list_project_tree", { projectPath })
      .then((nodes) => {
        if (cancelled) return;
        setFileTree(nodes);
      })
      .catch((err) => {
        if (cancelled) return;
        const message =
          typeof err === "string"
            ? err
            : err instanceof Error
              ? err.message
              : "加载目录结构失败";
        setError(message);
        setFileTree([]);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  useEffect(() => {
    setColumnViews({
      left: createColumnState(projectPath),
      right: createColumnState(projectPath),
    });
    setActiveColumn("left");
    lastSelectedRef.current = null;
  }, [projectPath]);

  useEffect(() => {
    const currentView =
      columnViews[activeColumn] ?? createColumnState(projectPath);
    const directoryPath =
      currentView.directoryPath && currentView.directoryPath.length > 0
        ? currentView.directoryPath
        : projectPath;
    if (lastSelectedRef.current !== directoryPath) {
      lastSelectedRef.current = directoryPath;
      onSelectDirectory(directoryPath);
    }
  }, [activeColumn, columnViews, onSelectDirectory, projectPath]);

  const columnComputed = useMemo(() => {
    const result: Record<
      ColumnId,
      { view: ColumnState; nodes: FileNode[]; displayPath: string }
    > = {
      left: {
        view: columnViews.left ?? createColumnState(projectPath),
        nodes: [],
        displayPath: getDisplayPath(projectPath, projectPath),
      },
      right: {
        view: columnViews.right ?? createColumnState(projectPath),
        nodes: [],
        displayPath: getDisplayPath(projectPath, projectPath),
      },
    };

    for (const columnId of COLUMN_IDS) {
      const view = columnViews[columnId] ?? createColumnState(projectPath);
      const nodes = getDirectoryEntries(
        fileTree,
        view.directoryPath,
        projectPath,
      );
      result[columnId] = {
        view,
        nodes,
        displayPath: getDisplayPath(view.directoryPath, projectPath),
      };
    }

    return result;
  }, [columnViews, fileTree, projectPath]);

  const goToParentDirectoryForColumn = useCallback(
    (columnId: ColumnId) => {
      setColumnViews((prev) => {
        const currentView = prev[columnId] ?? createColumnState(projectPath);
        const currentPath = currentView.directoryPath;
        const isAtRoot =
          normalizeForCompare(currentPath) === normalizedProjectPath &&
          currentView.stack.length === 0;

        if (isAtRoot) {
          return prev;
        }

        if (currentView.stack.length === 0) {
          return {
            ...prev,
            [columnId]: {
              directoryPath: projectPath,
              stack: [],
              lastVisitedChildPath: currentPath,
              lastVisitedChildParentPath: projectPath,
            },
          };
        }

        const parentPath = currentView.stack[currentView.stack.length - 1];
        return {
          ...prev,
          [columnId]: {
            directoryPath: parentPath,
            stack: currentView.stack.slice(0, -1),
            lastVisitedChildPath: currentPath,
            lastVisitedChildParentPath: parentPath,
          },
        };
      });
    },
    [normalizedProjectPath, projectPath],
  );

  const enterFolder = useCallback(
    (columnId: ColumnId, folder: FileNode) => {
      setColumnViews((prev) => {
        const currentView = prev[columnId] ?? createColumnState(projectPath);
        return {
          ...prev,
          [columnId]: {
            directoryPath: folder.path,
            stack: [...currentView.stack, currentView.directoryPath],
            lastVisitedChildPath: null,
            lastVisitedChildParentPath: null,
          },
        };
      });
    },
    [projectPath],
  );

  const handleEntryClick = useCallback(
    (
      _event: React.MouseEvent<HTMLButtonElement>,
      columnId: ColumnId,
      node: FileNode,
    ) => {
      setActiveColumn(columnId);
      if (node.type === "folder") {
        enterFolder(columnId, node);
      }
    },
    [enterFolder],
  );

  const handleEntryPointerDown = useCallback(
    (
      _event: React.PointerEvent<HTMLButtonElement>,
      _columnId: ColumnId,
      _node: FileNode,
    ) => {},
    [],
  );

  const handleEntryPointerUp = useCallback(
    (_event: React.PointerEvent<HTMLButtonElement>) => {},
    [],
  );

  const handleEntryContextMenu = useCallback(
    (
      _event: React.MouseEvent<HTMLButtonElement>,
      _columnId: ColumnId,
      _node: FileNode,
    ) => {},
    [],
  );

  const activeDirectoryDisplayPath = useMemo(() => {
    if (selectedDirectoryPath) {
      return getDisplayPath(selectedDirectoryPath, projectPath);
    }
    return getDisplayPath(projectPath, projectPath);
  }, [projectPath, selectedDirectoryPath]);

  if (!projectPath) {
    return (
      <div className="flex h-72 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        请选择一个项目以预览目录结构
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-72 items-center justify-center rounded-lg border text-sm text-muted-foreground">
        正在加载目录结构…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-72 items-center justify-center rounded-lg border border-destructive/40 bg-destructive/10 px-6 text-sm text-destructive">
        {error}
      </div>
    );
  }

  return (
    <div className="h-72 w-full overflow-hidden rounded-xl border bg-background">
      <ExplorerColumns
        columnOrder={columnOrder}
        columnComputed={columnComputed}
        activeColumn={activeColumn}
        activeFilePath={null}
        normalizedProjectPath={normalizedProjectPath}
        onColumnFocus={setActiveColumn}
        onGoToParent={goToParentDirectoryForColumn}
        onEntryClick={handleEntryClick}
        onEntryPointerDown={handleEntryPointerDown}
        onEntryPointerUp={handleEntryPointerUp}
        onEntryContextMenu={handleEntryContextMenu}
        activeDirectoryDisplayPath={activeDirectoryDisplayPath}
      />
    </div>
  );
}
