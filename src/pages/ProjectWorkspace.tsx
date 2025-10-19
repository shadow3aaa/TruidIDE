import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { xml } from "@codemirror/lang-xml";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Home,
  Menu,
  Plus,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FileNode, ProjectEntry } from "@/types/project";

import { CreateEntryDialog } from "./project-workspace/CreateEntryDialog";
import { EntryActionDialog } from "./project-workspace/EntryActionDialog";
import { ExplorerColumns } from "./project-workspace/ExplorerColumns";
import {
  BOTTOM_TABS,
  COLUMN_IDS,
  type BottomTabId,
  type ColumnId,
  type ColumnState,
  type CreateEntryType,
} from "./project-workspace/types";
import {
  cloneColumnState,
  createColumnState,
  findFolderNode,
  getDirectoryEntries,
  getDisplayPath,
  getParentDirectoryPath,
  isPathWithin,
  joinFsPath,
  normalizeFsPath,
  normalizeForCompare,
} from "./project-workspace/fs-utils";

const COLLAPSED_HEIGHT = 56;

type ProjectWorkspaceProps = {
  project: ProjectEntry;
  onBackHome: () => void;
};

function ProjectWorkspace({ project, onBackHome }: ProjectWorkspaceProps) {
  const projectPath = project.path;
  const normalizedProjectPath = useMemo(() => normalizeForCompare(projectPath), [projectPath]);

  const [activeBottomTab, setActiveBottomTab] = useState<BottomTabId>("files");

  const [isSidebarOpen, setSidebarOpen] = useState(false);

  const [isExplorerOpen, setExplorerOpen] = useState(false);

  const [fileTreeVersion, setFileTreeVersion] = useState(0);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [isLoadingFileTree, setIsLoadingFileTree] = useState(false);
  const [fileTreeError, setFileTreeError] = useState<string | null>(null);

  const [columnViews, setColumnViews] = useState<Record<ColumnId, ColumnState>>(() => ({
    left: createColumnState(projectPath),
    right: createColumnState(projectPath),
  }));
  const [activeColumn, setActiveColumn] = useState<ColumnId>("left");

  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [isLoadingFileContent, setIsLoadingFileContent] = useState(false);
  const [fileContentError, setFileContentError] = useState<string | null>(null);
  const [fileContentVersion, setFileContentVersion] = useState(0);
  const saveTimerRef = useRef<number | null>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewReloadToken, setPreviewReloadToken] = useState(0);

  const [isCreateEntryDialogOpen, setCreateEntryDialogOpen] = useState(false);
  const [createEntryType, setCreateEntryType] = useState<CreateEntryType>("file");
  const [createEntryName, setCreateEntryName] = useState("");
  const [createEntryError, setCreateEntryError] = useState<string | null>(null);
  const [isCreatingEntry, setCreatingEntry] = useState(false);

  const [entryActionContext, setEntryActionContext] = useState<
    { columnId: ColumnId; node: FileNode } | null
  >(null);
  const [isEntryActionDialogOpen, setEntryActionDialogOpen] = useState(false);
  const [entryActionError, setEntryActionError] = useState<string | null>(null);
  const [pendingEntryAction, setPendingEntryAction] = useState<"rename" | null>(null);
  const [renameEntryName, setRenameEntryName] = useState("");
  const [isProcessingEntryAction, setProcessingEntryAction] = useState(false);

  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cancelLongPress();
    };
  }, [cancelLongPress]);

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.source === window || !event.data || !('id' in event.data) || !('cmd' in event.data)) {
        return;
      }

      const { id, cmd, args } = event.data;
      const iframe = document.querySelector('iframe');
      if (!iframe || event.source !== iframe.contentWindow) {
        return;
      }

      try {
        const payload = await invoke(cmd, args);
        iframe.contentWindow?.postMessage({ id, payload }, '*');
      } catch (error) {
        iframe.contentWindow?.postMessage({ id, error }, '*');
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  const closeEntryActionDialog = useCallback(() => {
    setEntryActionDialogOpen(false);
    setEntryActionContext(null);
    setPendingEntryAction(null);
    setEntryActionError(null);
    setRenameEntryName("");
  }, []);

  const handleEntryActionDialogOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        if (isProcessingEntryAction) {
          return;
        }
        closeEntryActionDialog();
        return;
      }
      setEntryActionDialogOpen(true);
    },
    [closeEntryActionDialog, isProcessingEntryAction],
  );

  const openEntryActionDialog = useCallback(
    (columnId: ColumnId, node: FileNode) => {
      setActiveColumn(columnId);
      setEntryActionContext({ columnId, node });
      setEntryActionDialogOpen(true);
      setPendingEntryAction(null);
      setEntryActionError(null);
      setRenameEntryName(node.name);
    },
    [setActiveColumn],
  );

  const handleEntryPointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, columnId: ColumnId, node: FileNode) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      cancelLongPress();
      longPressTriggeredRef.current = false;
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTriggeredRef.current = true;
        openEntryActionDialog(columnId, node);
      }, 450);
    },
    [cancelLongPress, openEntryActionDialog],
  );

  const handleEntryPointerUp = useCallback(
    (_event: React.PointerEvent<HTMLButtonElement>) => {
      cancelLongPress();
    },
    [cancelLongPress],
  );

  const handleEntryContextMenu = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, columnId: ColumnId, node: FileNode) => {
      event.preventDefault();
      cancelLongPress();
      longPressTriggeredRef.current = false;
      openEntryActionDialog(columnId, node);
    },
    [cancelLongPress, openEntryActionDialog],
  );

  const handleStartRenameEntryAction = useCallback(() => {
    if (!entryActionContext || isProcessingEntryAction) {
      return;
    }
    setPendingEntryAction("rename");
    setRenameEntryName(entryActionContext.node.name);
    setEntryActionError(null);
  }, [entryActionContext, isProcessingEntryAction]);

  const handleCancelRenameEntryAction = useCallback(() => {
    if (!entryActionContext || isProcessingEntryAction) {
      return;
    }
    setPendingEntryAction(null);
    setEntryActionError(null);
    setRenameEntryName(entryActionContext.node.name);
  }, [entryActionContext, isProcessingEntryAction]);

  useEffect(() => {
    if (entryActionContext) {
      setRenameEntryName(entryActionContext.node.name);
    }
  }, [entryActionContext]);

  const requestPreviewReload = useCallback(() => {
    setPreviewReloadToken((token) => token + 1);
  }, []);

  const refreshFileTree = useCallback(() => {
    setFileTreeVersion((token) => token + 1);
  }, []);

  const toggleExplorer = useCallback(() => {
    setExplorerOpen(!isExplorerOpen);
  }, [isExplorerOpen]);



  useEffect(() => {
    setActiveFilePath(null);
    setFileContent("");
    setFileContentError(null);
    setIsLoadingFileContent(false);
    setFileContentVersion(0);
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    setExplorerOpen(true);
    setActiveBottomTab("files");
    setPreviewUrl(null);
    setPreviewError(null);
    setIsLoadingPreview(false);
    setPreviewReloadToken(0);
    setColumnViews({
      left: createColumnState(projectPath),
      right: createColumnState(projectPath),
    });
    setActiveColumn("left");
  }, [projectPath]);

  const columnOrder = useMemo<ColumnId[]>(() => COLUMN_IDS, []);

  const columnComputed = useMemo(() => {
    const result: Record<ColumnId, { view: ColumnState; nodes: FileNode[]; displayPath: string }> = {
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
      const nodes = getDirectoryEntries(fileTree, view.directoryPath, projectPath);
      result[columnId] = {
        view,
        nodes,
        displayPath: getDisplayPath(view.directoryPath, projectPath),
      };
    }

    return result;
  }, [columnViews, fileTree, projectPath]);

  const activeColumnData = columnComputed[activeColumn] ?? {
    view: createColumnState(projectPath),
    nodes: [],
    displayPath: getDisplayPath(projectPath, projectPath),
  };

  const activeDirectoryPath = activeColumnData.view.directoryPath;
  const activeDirectoryDisplayPath = activeColumnData.displayPath;
  const canGoToParent =
    normalizeForCompare(activeDirectoryPath) !== normalizedProjectPath ||
    activeColumnData.view.stack.length > 0;
  const canGoToLastVisitedChild = Boolean(
    activeColumnData.view.lastVisitedChildPath &&
      activeColumnData.view.lastVisitedChildParentPath &&
      normalizeForCompare(activeColumnData.view.lastVisitedChildParentPath) ===
        normalizeForCompare(activeDirectoryPath),
  );

  const handleFileSelect = useCallback(
    (node: FileNode) => {
      if (node.type !== "file") {
        return;
      }

      if (node.path === activeFilePath) {
        setFileContentVersion((token) => token + 1);
        return;
      }

      setActiveFilePath(node.path);
      setFileContent("");
      setFileContentError(null);
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      setFileContentVersion((token) => token + 1);
    },
    [activeFilePath],
  );

  const refreshFileContent = useCallback(() => {
    if (!activeFilePath) {
      return;
    }
    setFileContentVersion((token) => token + 1);
  }, [activeFilePath]);

  const resetCreateEntryForm = useCallback(() => {
    setCreateEntryName("");
    setCreateEntryType("file");
    setCreateEntryError(null);
    setCreatingEntry(false);
  }, []);

  const handleCreateDialogOpenChange = useCallback(
    (open: boolean) => {
      if (!open && isCreatingEntry) {
        return;
      }
      setCreateEntryDialogOpen(open);
      if (!open) {
        resetCreateEntryForm();
      }
    },
    [isCreatingEntry, resetCreateEntryForm],
  );

  const openCreateEntryDialog = useCallback(() => {
    resetCreateEntryForm();
    setCreateEntryDialogOpen(true);
  }, [resetCreateEntryForm]);

  const handleCreateEntrySubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (isCreatingEntry) {
        return;
      }

      const trimmedName = createEntryName.trim();
      if (!trimmedName) {
        setCreateEntryError("名称不能为空");
        return;
      }

      if (/[\\/]/.test(trimmedName)) {
        setCreateEntryError("名称不能包含路径分隔符");
        return;
      }

    setCreatingEntry(true);
    setCreateEntryError(null);

    const parentPath = activeDirectoryPath;

      try {
        await invoke("create_project_entry", {
          parentPath,
          name: trimmedName,
          kind: createEntryType,
        });
        resetCreateEntryForm();
        setCreateEntryDialogOpen(false);
        refreshFileTree();
      } catch (error) {
        const message =
          typeof error === "string"
            ? error
            : error instanceof Error
              ? error.message
              : "创建失败";
        setCreateEntryError(message);
      } finally {
        setCreatingEntry(false);
      }
    },
    [activeDirectoryPath, createEntryName, createEntryType, isCreatingEntry, refreshFileTree, resetCreateEntryForm],
  );

  useEffect(() => {
    let cancelled = false;

    setIsLoadingFileTree(true);
    setFileTreeError(null);

    invoke<FileNode[]>("list_project_tree", { projectPath })
      .then((nodes) => {
        if (cancelled) {
          return;
        }
        setFileTree(nodes);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        const message =
          typeof error === "string"
            ? error
            : error instanceof Error
              ? error.message
              : "加载项目文件结构失败";
        setFileTreeError(message);
        setFileTree([]);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingFileTree(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fileTreeVersion, projectPath]);

  useEffect(() => {
    if (!fileTree.length) {
      return;
    }

    setColumnViews((prev) => {
      let changed = false;
      const next = { ...prev } as Record<ColumnId, ColumnState>;

      for (const columnId of COLUMN_IDS) {
        const view = prev[columnId] ?? createColumnState(projectPath);
        const normalizedCurrent = normalizeForCompare(view.directoryPath);

        if (normalizedCurrent === normalizedProjectPath) {
          if (!prev[columnId]) {
            next[columnId] = view;
            changed = true;
          }
          continue;
        }

        if (!findFolderNode(fileTree, view.directoryPath)) {
          next[columnId] = createColumnState(projectPath);
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [fileTree, normalizedProjectPath, projectPath]);

  useEffect(() => {
    if (!activeFilePath) {
      setFileContent("");
      setIsLoadingFileContent(false);
      setFileContentError(null);
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      return;
    }

    let cancelled = false;

    setIsLoadingFileContent(true);
    setFileContentError(null);

    invoke<string>("read_project_file", { filePath: activeFilePath })
      .then((content) => {
        if (cancelled) {
          return;
        }
        setFileContent(content);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        const message =
          typeof error === "string"
            ? error
            : error instanceof Error
              ? error.message
              : "读取文件失败";
        setFileContentError(message);
        setFileContent("");
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingFileContent(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeFilePath, fileContentVersion]);

  const activeFileName = useMemo(() => {
    if (!activeFilePath) {
      return null;
    }
    const parts = activeFilePath.split(/[/\\]/);
    return parts[parts.length - 1] ?? null;
  }, [activeFilePath]);

  const editorExtensions = useMemo(() => {
    const extensions = [EditorView.lineWrapping];

    if (!activeFilePath) {
      return extensions;
    }

    const normalized = activeFilePath.toLowerCase();

    if (/(\.(ts|tsx|js|jsx))$/.test(normalized)) {
      extensions.push(javascript({ jsx: true, typescript: true }));
    } else if (normalized.endsWith(".json")) {
      extensions.push(json());
    } else if (normalized.endsWith(".css")) {
      extensions.push(css());
    } else if (normalized.endsWith(".html") || normalized.endsWith(".htm")) {
      extensions.push(html());
    } else if (normalized.endsWith(".md") || normalized.endsWith(".markdown")) {
      extensions.push(markdown());
    } else if (normalized.endsWith(".xml")) {
      extensions.push(xml());
    }

    return extensions;
  }, [activeFilePath]);

  const activeFileDisplayPath = useMemo(() => {
    if (!activeFilePath) {
      return null;
    }

    const filePathNormalized = normalizeFsPath(activeFilePath);
    const projectRootNormalized = normalizeFsPath(projectPath);

    if (normalizeForCompare(filePathNormalized).startsWith(normalizeForCompare(projectRootNormalized))) {
      const relative = filePathNormalized.slice(projectRootNormalized.length).replace(/^\/+/, "");
      if (relative.length > 0) {
        return `./${relative}`;
      }
      return `./${activeFileName ?? ""}`;
    }

    return filePathNormalized;
  }, [activeFilePath, projectPath, activeFileName]);

  const goToParentDirectoryForColumn = useCallback(
    (columnId: ColumnId) => {
      setColumnViews((prev) => {
        const currentView = prev[columnId] ?? createColumnState(projectPath);
        const currentPath = currentView.directoryPath;
        const isAtProjectRoot =
          normalizeForCompare(currentPath) === normalizedProjectPath && currentView.stack.length === 0;

        if (isAtProjectRoot) {
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

  const goToParentDirectory = useCallback(() => {
    goToParentDirectoryForColumn(activeColumn);
  }, [activeColumn, goToParentDirectoryForColumn]);

  const goToLastVisitedChildDirectory = useCallback(() => {
    setColumnViews((prev) => {
      const currentView = prev[activeColumn] ?? createColumnState(projectPath);
      const { lastVisitedChildPath, lastVisitedChildParentPath } = currentView;

      if (!lastVisitedChildPath || !lastVisitedChildParentPath) {
        return prev;
      }

      if (
        normalizeForCompare(lastVisitedChildParentPath) !==
        normalizeForCompare(currentView.directoryPath)
      ) {
        return prev;
      }

      return {
        ...prev,
        [activeColumn]: {
          directoryPath: lastVisitedChildPath,
          stack: [...currentView.stack, currentView.directoryPath],
          lastVisitedChildPath: null,
          lastVisitedChildParentPath: null,
        },
      };
    });
  }, [activeColumn, projectPath]);

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

  const handleDirectoryEntrySelect = useCallback(
    (columnId: ColumnId, node: FileNode) => {
      setActiveColumn(columnId);
      if (node.type === "folder") {
        enterFolder(columnId, node);
      } else {
        handleFileSelect(node);
      }
    },
    [enterFolder, handleFileSelect],
  );

  const handleEntryClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, columnId: ColumnId, node: FileNode) => {
      if (longPressTriggeredRef.current) {
        longPressTriggeredRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      handleDirectoryEntrySelect(columnId, node);
    },
    [handleDirectoryEntrySelect],
  );

  const handleDeleteEntry = useCallback(async () => {
    if (!entryActionContext) {
      return;
    }

    setProcessingEntryAction(true);
    setEntryActionError(null);

    try {
      await invoke("delete_project_entry", {
        path: entryActionContext.node.path,
      });

      if (entryActionContext.node.type === "file") {
        if (
          activeFilePath &&
          normalizeForCompare(activeFilePath) === normalizeForCompare(entryActionContext.node.path)
        ) {
          setActiveFilePath(null);
        }
      } else if (activeFilePath && isPathWithin(activeFilePath, entryActionContext.node.path)) {
        setActiveFilePath(null);
      }

      refreshFileTree();
      closeEntryActionDialog();
    } catch (error) {
      const message =
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "删除失败";
      setEntryActionError(message);
    } finally {
      setProcessingEntryAction(false);
    }
  }, [activeFilePath, closeEntryActionDialog, entryActionContext, refreshFileTree]);

  const handleRenameEntrySubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!entryActionContext) {
        return;
      }

      const trimmed = renameEntryName.trim();
      if (!trimmed) {
        setEntryActionError("名称不能为空");
        return;
      }

      if (trimmed === entryActionContext.node.name) {
        closeEntryActionDialog();
        return;
      }

      setProcessingEntryAction(true);
      setEntryActionError(null);

      try {
        await invoke("rename_project_entry", {
          path: entryActionContext.node.path,
          newName: trimmed,
        });

        if (entryActionContext.node.type === "file") {
          if (
            activeFilePath &&
            normalizeForCompare(activeFilePath) === normalizeForCompare(entryActionContext.node.path)
          ) {
            const parentPath = getParentDirectoryPath(entryActionContext.node.path);
            const renamedPath = joinFsPath(parentPath, trimmed);
            setActiveFilePath(renamedPath);
          }
        } else if (activeFilePath && isPathWithin(activeFilePath, entryActionContext.node.path)) {
          setActiveFilePath(null);
        }

        refreshFileTree();
        closeEntryActionDialog();
      } catch (error) {
        const message =
          typeof error === "string"
            ? error
            : error instanceof Error
              ? error.message
              : "重命名失败";
        setEntryActionError(message);
      } finally {
        setProcessingEntryAction(false);
      }
    },
    [activeFilePath, closeEntryActionDialog, entryActionContext, refreshFileTree, renameEntryName],
  );

  const handleCopyOrMove = useCallback(
    async (mode: "copy" | "move") => {
      if (!entryActionContext) {
        return;
      }

      const otherColumn: ColumnId = entryActionContext.columnId === "left" ? "right" : "left";
      const targetDirectoryPath = columnViews[otherColumn]?.directoryPath ?? projectPath;

      setProcessingEntryAction(true);
      setEntryActionError(null);

      try {
        const command = mode === "copy" ? "copy_project_entry" : "move_project_entry";
        await invoke(command, {
          sourcePath: entryActionContext.node.path,
          targetDirectoryPath,
        });

        if (mode === "move") {
          if (entryActionContext.node.type === "file") {
            if (
              activeFilePath &&
              normalizeForCompare(activeFilePath) === normalizeForCompare(entryActionContext.node.path)
            ) {
              const destinationPath = joinFsPath(targetDirectoryPath, entryActionContext.node.name);
              setActiveFilePath(destinationPath);
            }
          } else if (
            activeFilePath &&
            isPathWithin(activeFilePath, entryActionContext.node.path)
          ) {
            setActiveFilePath(null);
          }
        }

        refreshFileTree();
        closeEntryActionDialog();
      } catch (error) {
        const message =
          typeof error === "string"
            ? error
            : error instanceof Error
              ? error.message
              : mode === "copy"
                ? "复制失败"
                : "移动失败";
        setEntryActionError(message);
      } finally {
        setProcessingEntryAction(false);
      }
    },
    [activeFilePath, closeEntryActionDialog, columnViews, entryActionContext, projectPath, refreshFileTree],
  );

  const handleSwapColumns = useCallback(() => {
    const otherColumn: ColumnId = activeColumn === "left" ? "right" : "left";

    setColumnViews((prev) => {
      const activeState = prev[activeColumn] ?? createColumnState(projectPath);

      return {
        ...prev,
        [otherColumn]: cloneColumnState(activeState),
      };
    });
  }, [activeColumn, projectPath]);
  const isFilesTab = activeBottomTab === "files";

  useEffect(() => {
    if (activeBottomTab !== "preview") {
      return;
    }

    let cancelled = false;
    setIsLoadingPreview(true);
    setPreviewError(null);
    setPreviewUrl(null);

    invoke<string>("resolve_preview_entry", { projectPath })
      .then((entryPath) => {
        if (cancelled) {
          return;
        }
        const baseUrl = convertFileSrc(entryPath);
        const separator = baseUrl.includes("?") ? "&" : "?";
        const timestamp = Date.now();
        const cacheBustedUrl = `${baseUrl}${separator}v=${timestamp}-${previewReloadToken}`;
        setPreviewUrl(cacheBustedUrl);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        const message =
          typeof error === "string"
            ? error
            : error instanceof Error
              ? error.message
              : "生成预览失败";
        setPreviewError(message);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingPreview(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeBottomTab, previewReloadToken, projectPath]);

  return (
    <div className="flex h-full overflow-hidden bg-background">
      {/* 遮罩层 */}
      {isSidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-label="关闭侧边栏"
        />
      )}

      {/* 抽屉式侧边栏 */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-card px-5 py-6 text-sm text-muted-foreground shadow-lg transition-transform duration-300 ease-in-out lg:static lg:z-auto lg:shadow-none lg:translate-x-0",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b pb-4">
          <h1 className="truncate text-lg font-semibold text-foreground">{project.name}</h1>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="关闭侧边栏"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <nav className="mt-6 flex flex-col gap-2">
          <Button
            type="button"
            variant="ghost"
            className="justify-start gap-2"
            onClick={onBackHome}
          >
            <Home className="h-4 w-4" />
            主页
          </Button>
        </nav>
      </aside>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* 移动端顶栏菜单按钮 */}
        <div className="flex items-center gap-2 border-b bg-card/50 px-4 py-3 backdrop-blur lg:hidden">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(true)}
            aria-label="打开侧边栏"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <h2 className="truncate text-sm font-semibold text-foreground">{project.name}</h2>
        </div>

        <main className="flex-1 overflow-y-auto px-4 pt-6 pb-28 sm:px-6 sm:py-8">
          <div className="mx-auto max-w-4xl">
            <section className="flex flex-1 flex-col gap-4">
          <div className="flex flex-col gap-2 border-b border-border/60 pb-4">
            {activeFilePath ? (
              <p className="break-all text-xs text-muted-foreground">
                {activeFileDisplayPath ?? activeFilePath}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                从下方面板进入“文件管理”选择一个文件开始编辑。
              </p>
            )}
          </div>
          <div className="relative flex-1 overflow-hidden">
            {isLoadingFileContent ? (
              <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
                正在加载文件内容…
              </div>
            ) : fileContentError ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="text-sm text-destructive">{fileContentError}</p>
                <Button size="sm" variant="outline" onClick={refreshFileContent}>
                  重试
                </Button>
              </div>
            ) : activeFilePath ? (
              <CodeMirror
                value={fileContent}
                height="100%"
                extensions={editorExtensions}
                onChange={(value) => {
                  if (value === fileContent) {
                    return;
                  }

                  setFileContent(value);

                  if (saveTimerRef.current !== null) {
                    window.clearTimeout(saveTimerRef.current);
                  }

                  const targetPath = activeFilePath;
                  const timerId = window.setTimeout(() => {
                    if (!targetPath) {
                      return;
                    }

                    invoke("save_project_file", {
                      filePath: targetPath,
                      contents: value,
                    })
                      .then(() => {
                        if (activeBottomTab === "preview") {
                          requestPreviewReload();
                        }
                      })
                      .catch((error: unknown) => {
                        console.error("保存文件失败", error);
                      })
                      .finally(() => {
                        if (saveTimerRef.current === timerId) {
                          saveTimerRef.current = null;
                        }
                      });
                  }, 600);

                  saveTimerRef.current = timerId;
                }}
                basicSetup={{ highlightActiveLine: true, bracketMatching: true }}
                minHeight="100%"
              />
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
                选择一个文件以在此处查看或编辑内容。
              </div>
            )}
          </div>
                      </section>
                    </div>
                  </main>
        {isExplorerOpen && (
          <button
            type="button"
            aria-label="关闭底部面板"
            className="fixed inset-0 z-30 bg-background/70 backdrop-blur-sm"
            onClick={() => setExplorerOpen(false)}
          />
        )}

        <section
          className={cn(
            "fixed inset-x-0 bottom-0 z-40 flex flex-col border-t border-border/60 bg-background/95 shadow-lg transition-[height] duration-300 ease-out supports-[backdrop-filter]:bg-background/70",
            isExplorerOpen ? "h-full" : `h-[${COLLAPSED_HEIGHT}px]`,
          )}
          aria-expanded={isExplorerOpen}
        >
        <div className="flex flex-col px-4 pt-2 pb-2">
          {isExplorerOpen ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-1 rounded-full border bg-muted/60 p-1">
                {BOTTOM_TABS.map((tab) => {
                  const isActive = activeBottomTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveBottomTab(tab.id)}
                      className={cn(
                        "rounded-full px-3 py-1 text-sm font-medium transition",
                        isActive
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                {isFilesTab ? (
                  <Button variant="outline" size="sm" onClick={refreshFileTree} disabled={isLoadingFileTree}>
                    {isLoadingFileTree ? "刷新中…" : "刷新"}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
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
                {['[', ']', '{', '}', '(', ')', '<', '>', '=', '+', '-', '*', '/'].map((key) => (
                  <Button key={key} variant="outline" size="sm" className="px-3">
                    {key}
                  </Button>
                ))}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="flex-shrink-0"
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
                    <span className="font-medium text-foreground">{activeDirectoryDisplayPath}</span>
                  </div>
                  <div className="flex-1 overflow-hidden px-2">
                    {isLoadingFileTree ? (
                      <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
                        正在读取项目结构…
                      </div>
                    ) : fileTreeError ? (
                      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                        <p className="text-sm text-destructive">{fileTreeError}</p>
                        <Button size="sm" variant="outline" onClick={refreshFileTree}>
                          重试
                        </Button>
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
                        onColumnFocus={setActiveColumn}
                        onGoToParent={goToParentDirectoryForColumn}
                        onEntryClick={handleEntryClick}
                        onEntryPointerDown={handleEntryPointerDown}
                        onEntryPointerUp={handleEntryPointerUp}
                        onEntryContextMenu={handleEntryContextMenu}
                      />
                    )}
                  </div>
                  <div className="px-2 pt-2">
                    <div className="flex items-center justify-around">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
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
                        onClick={openCreateEntryDialog}
                        aria-label="新建文件或文件夹"
                      >
                        <Plus className="h-5 w-5" aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
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
                  ) : previewError ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
                      <p className="text-sm text-destructive">{previewError}</p>
                      <Button size="sm" variant="outline" onClick={requestPreviewReload}>
                        重试
                      </Button>
                    </div>
                  ) : previewUrl ? (
                    <iframe
                      key={previewUrl}
                      src={previewUrl}
                      title="项目实时预览"
                      className="h-full w-full border-0 bg-background"
                    />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
                      <p>选择下方的“刷新预览”以加载项目效果。</p>
                      <p>若项目尚未生成入口文件，请在项目目录中提供 index.html。</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </section>
      <EntryActionDialog
        open={isEntryActionDialogOpen}
        context={entryActionContext}
        pendingAction={pendingEntryAction}
        isProcessing={isProcessingEntryAction}
        error={entryActionError}
        renameEntryName={renameEntryName}
        columnViews={columnViews}
        projectPath={projectPath}
        onOpenChange={handleEntryActionDialogOpenChange}
        onRenameNameChange={setRenameEntryName}
        onStartRename={handleStartRenameEntryAction}
        onCancelRename={handleCancelRenameEntryAction}
        onSubmitRename={handleRenameEntrySubmit}
        onCopyOrMove={handleCopyOrMove}
        onDelete={handleDeleteEntry}
      />
      <CreateEntryDialog
        open={isCreateEntryDialogOpen}
        activeDirectoryDisplayPath={activeDirectoryDisplayPath}
        entryType={createEntryType}
        entryName={createEntryName}
        isProcessing={isCreatingEntry}
        error={createEntryError}
        onOpenChange={handleCreateDialogOpenChange}
        onTypeChange={setCreateEntryType}
        onNameChange={setCreateEntryName}
        onSubmit={handleCreateEntrySubmit}
      />
      </div>
    </div>
  );
}

export default ProjectWorkspace;
