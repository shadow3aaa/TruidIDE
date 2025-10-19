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
  ChevronRight,
  FileText,
  Folder,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

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
import { cn } from "@/lib/utils";
import type { FileNode, ProjectEntry } from "@/types/project";

const DEFAULT_EXPANDED_HEIGHT = 420;
const MIN_SHEET_HEIGHT = 180;
const COLLAPSED_HEIGHT = 76;

type BottomTabId = "files" | "preview";
type CreateEntryType = "file" | "folder";
type ColumnId = "left" | "right";

type ColumnState = {
  directoryPath: string;
  stack: string[];
  lastVisitedChildPath: string | null;
  lastVisitedChildParentPath: string | null;
};

const BOTTOM_TABS: Array<{ id: BottomTabId; label: string }> = [
  { id: "files", label: "文件管理" },
  { id: "preview", label: "实时预览" },
];

const COLUMN_IDS: ColumnId[] = ["left", "right"];

const getDisplayPath = (directoryPath: string, projectPath: string): string => {
  const current = normalizeFsPath(directoryPath);
  const project = normalizeFsPath(projectPath);

  if (current.toLowerCase() === project.toLowerCase()) {
    return "./";
  }

  if (current.toLowerCase().startsWith(project.toLowerCase())) {
    const relative = current.slice(project.length).replace(/^\/+/, "");
    return relative.length ? `./${relative}` : "./";
  }

  return current || "./";
};

const normalizeFsPath = (value: string): string => {
  if (!value) {
    return "";
  }
  const withoutUnc = value.startsWith("\\\\?\\") ? value.slice(4) : value;
  return withoutUnc.replace(/\\/g, "/").replace(/\/+$/, "");
};

const normalizeForCompare = (value: string): string => normalizeFsPath(value).toLowerCase();

const createColumnState = (directoryPath: string): ColumnState => ({
  directoryPath,
  stack: [],
  lastVisitedChildPath: null,
  lastVisitedChildParentPath: null,
});

const cloneColumnState = (state: ColumnState): ColumnState => ({
  directoryPath: state.directoryPath,
  stack: [...state.stack],
  lastVisitedChildPath: state.lastVisitedChildPath,
  lastVisitedChildParentPath: state.lastVisitedChildParentPath,
});

const getParentDirectoryPath = (path: string): string => {
  if (!path) {
    return "";
  }
  const trimmed = path.replace(/[\\/]+$/, "");
  const lastBackslash = trimmed.lastIndexOf("\\");
  const lastSlash = trimmed.lastIndexOf("/");
  const index = Math.max(lastBackslash, lastSlash);
  if (index === -1) {
    return "";
  }
  return trimmed.slice(0, index);
};

const joinFsPath = (directoryPath: string, childName: string): string => {
  if (!directoryPath) {
    return childName;
  }
  const lastChar = directoryPath.charAt(directoryPath.length - 1);
  if (lastChar === "/" || lastChar === "\\") {
    return `${directoryPath}${childName}`;
  }
  const separator = directoryPath.includes("\\") && !directoryPath.includes("/") ? "\\" : "/";
  return `${directoryPath}${separator}${childName}`;
};

const isPathWithin = (path: string, directoryPath: string): boolean => {
  if (!path || !directoryPath) {
    return false;
  }
  const target = normalizeForCompare(path);
  const parent = normalizeForCompare(directoryPath);
  if (!target || !parent) {
    return false;
  }
  if (target === parent) {
    return true;
  }
  return target.startsWith(`${parent}/`);
};

const sortNodesByName = (nodes: FileNode[]): FileNode[] => {
  return [...nodes].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
};

const findFolderNode = (nodes: FileNode[], targetPath: string): FileNode | null => {
  const targetNormalized = normalizeForCompare(targetPath);

  const walk = (list: FileNode[]): FileNode | null => {
    for (const node of list) {
      if (node.type !== "folder") {
        continue;
      }
      if (normalizeForCompare(node.path) === targetNormalized) {
        return node;
      }
      if (node.children?.length) {
        const match = walk(node.children);
        if (match) {
          return match;
        }
      }
    }
    return null;
  };

  return walk(nodes);
};

const getDirectoryEntries = (tree: FileNode[], directoryPath: string, projectPath: string): FileNode[] => {
  if (!tree.length) {
    return [];
  }

  const projectNormalized = normalizeForCompare(projectPath);
  const directoryNormalized = normalizeForCompare(directoryPath);

  if (directoryNormalized === projectNormalized) {
    return sortNodesByName(tree);
  }

  const folderNode = findFolderNode(tree, directoryPath);
  if (!folderNode?.children?.length) {
    return [];
  }

  return sortNodesByName(folderNode.children);
};

type ProjectWorkspaceProps = {
  project: ProjectEntry;
  onBackHome: () => void;
};

function ProjectWorkspace({ project, onBackHome }: ProjectWorkspaceProps) {
  const projectPath = project.path;
  const normalizedProjectPath = useMemo(() => normalizeForCompare(projectPath), [projectPath]);

  const [activeBottomTab, setActiveBottomTab] = useState<BottomTabId>("files");
  const activeBottomTabRef = useRef<BottomTabId>("files");

  const [isExplorerOpen, setExplorerOpen] = useState(true);
  const [isExplorerFullscreen, setExplorerFullscreen] = useState(false);
  const [isDraggingExplorer, setDraggingExplorer] = useState(false);
  const [explorerHeight, setExplorerHeight] = useState(() => DEFAULT_EXPANDED_HEIGHT);
  const explorerHandleRef = useRef<HTMLButtonElement | null>(null);
  const dragStateRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);

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

  useEffect(() => {
    if (entryActionContext) {
      setRenameEntryName(entryActionContext.node.name);
    }
  }, [entryActionContext]);

  const clampExplorerHeight = useCallback((value: number) => {
    const viewportHeight = window.innerHeight || 720;
    const maxSheetHeight = Math.max(MIN_SHEET_HEIGHT, Math.floor(viewportHeight * 0.75));
    return Math.min(Math.max(value, MIN_SHEET_HEIGHT), maxSheetHeight);
  }, []);

  const requestPreviewReload = useCallback(() => {
    setPreviewReloadToken((token) => token + 1);
  }, []);

  const refreshFileTree = useCallback(() => {
    setFileTreeVersion((token) => token + 1);
  }, []);

  const finalizeExplorerHeight = useCallback(
    (height: number) => {
      const viewportHeight = window.innerHeight || 720;
      const fullscreenThreshold = Math.max(viewportHeight * 0.72, MIN_SHEET_HEIGHT + 60);
      const collapseThreshold = MIN_SHEET_HEIGHT + 20;

      if (height >= fullscreenThreshold) {
        setExplorerFullscreen(true);
        setExplorerOpen(true);
        return viewportHeight;
      }

      if (height <= collapseThreshold) {
        setExplorerFullscreen(false);
        setExplorerOpen(false);
        return COLLAPSED_HEIGHT;
      }

      setExplorerFullscreen(false);
      setExplorerOpen(true);
      return clampExplorerHeight(height);
    },
    [clampExplorerHeight],
  );

  const handleExplorerPointerMove = useCallback(
    (event: PointerEvent) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) {
        return;
      }

      const delta = state.startY - event.clientY;
      const nextHeight = clampExplorerHeight(state.startHeight + delta);
      setExplorerHeight(nextHeight);
    },
    [clampExplorerHeight],
  );

  const finishExplorerDrag = useCallback(
    (event?: PointerEvent) => {
      const state = dragStateRef.current;
      if (!state || (event && state.pointerId !== event.pointerId)) {
        return;
      }

      if (explorerHandleRef.current?.hasPointerCapture(state.pointerId)) {
        explorerHandleRef.current.releasePointerCapture(state.pointerId);
      }

      dragStateRef.current = null;
      setDraggingExplorer(false);

      setExplorerHeight((currentHeight) => finalizeExplorerHeight(currentHeight));
    },
    [finalizeExplorerHeight],
  );

  const startExplorerDrag = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();

      const initialHeight = isExplorerOpen
        ? explorerHeight
        : clampExplorerHeight(DEFAULT_EXPANDED_HEIGHT);

      dragStateRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startHeight: initialHeight,
      };

      setExplorerOpen(true);
      setExplorerFullscreen(false);
      setExplorerHeight(initialHeight);
      setDraggingExplorer(true);

      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [clampExplorerHeight, explorerHeight, isExplorerOpen],
  );

  const toggleExplorer = useCallback(() => {
    if (isExplorerFullscreen) {
      setExplorerFullscreen(false);
      setExplorerHeight(clampExplorerHeight(DEFAULT_EXPANDED_HEIGHT));
      return;
    }

    if (isExplorerOpen) {
      setExplorerOpen(false);
    } else {
      setExplorerOpen(true);
      setExplorerHeight(clampExplorerHeight(DEFAULT_EXPANDED_HEIGHT));
    }
  }, [clampExplorerHeight, isExplorerFullscreen, isExplorerOpen]);

  useEffect(() => {
    if (!isDraggingExplorer) {
      return;
    }

    const handleMove = (event: PointerEvent) => {
      handleExplorerPointerMove(event);
    };

    const handleUp = (event: PointerEvent) => {
      finishExplorerDrag(event);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [finishExplorerDrag, handleExplorerPointerMove, isDraggingExplorer]);

  useEffect(() => {
    activeBottomTabRef.current = activeBottomTab;
  }, [activeBottomTab]);

  useEffect(() => {
    if (!isExplorerOpen) {
      setExplorerFullscreen(false);
      setExplorerHeight(COLLAPSED_HEIGHT);
    }
  }, [isExplorerOpen]);

  useEffect(() => {
    if (!isExplorerOpen || !isExplorerFullscreen) {
      return;
    }

    const updateHeight = () => {
      const viewportHeight = window.innerHeight || 720;
      setExplorerHeight(viewportHeight);
    };

    updateHeight();
    window.addEventListener("resize", updateHeight);
    return () => {
      window.removeEventListener("resize", updateHeight);
    };
  }, [isExplorerFullscreen, isExplorerOpen]);

  useEffect(() => {
    if (activeBottomTab !== "preview" && isExplorerFullscreen) {
      setExplorerFullscreen(false);
      setExplorerHeight(clampExplorerHeight(DEFAULT_EXPANDED_HEIGHT));
    }
  }, [activeBottomTab, clampExplorerHeight, isExplorerFullscreen]);

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
    setExplorerFullscreen(false);
    setExplorerHeight(clampExplorerHeight(DEFAULT_EXPANDED_HEIGHT));
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
  }, [projectPath, clampExplorerHeight]);

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

    const normalizePath = (value: string) => {
      const withoutUnc = value.startsWith("\\\\?\\") ? value.slice(4) : value;
      return withoutUnc.replace(/[\\/]+$/, "").replace(/\\+/g, "/");
    };

    const filePathNormalized = normalizePath(activeFilePath);
    const projectRootNormalized = normalizePath(projectPath);

    if (filePathNormalized.toLowerCase().startsWith(projectRootNormalized.toLowerCase())) {
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
  const bottomSheetHint = (() => {
    if (activeBottomTab === "preview") {
      if (isExplorerFullscreen) {
        return "向下拖动可退出全屏预览";
      }
      return isExplorerOpen ? "上拉可扩大预览，再次上拉可进入全屏" : "上拉以查看实时预览";
    }
    return isExplorerOpen ? "拖拽顶边可调整高度" : "上拉以查看项目文件";
  })();

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
    <div className="relative flex min-h-screen flex-col pb-40">
      <header className="border-b bg-card/80 px-6 py-4 backdrop-blur">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{project.name}</h1>
          </div>
          <Button variant="secondary" onClick={onBackHome}>
            返回首页
          </Button>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-6 px-6 py-8">
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
                        if (activeBottomTabRef.current === "preview") {
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
      </main>

      {isExplorerOpen && explorerHeight > COLLAPSED_HEIGHT + 24 ? (
        <button
          type="button"
          aria-label="关闭底部面板"
          className="fixed inset-0 z-30 bg-background/70 backdrop-blur-sm"
          onClick={() => setExplorerOpen(false)}
        />
      ) : null}

      <section
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 flex flex-col rounded-t-2xl border border-b-0 border-border/60 bg-background/95 shadow-lg transition-[height] duration-300 ease-out supports-[backdrop-filter]:bg-background/70",
          isExplorerOpen ? "" : "border-opacity-40",
        )}
        style={{
          height: isExplorerOpen ? explorerHeight : COLLAPSED_HEIGHT,
        }}
        aria-expanded={isExplorerOpen}
      >
        <div className="flex flex-col px-4 pt-3">
          <button
            ref={explorerHandleRef}
            type="button"
            aria-label={isExplorerOpen ? "拖动或收起底部面板" : "展开底部面板"}
            onPointerDown={startExplorerDrag}
            className="mx-auto mb-3 flex w-16 items-center justify-center rounded-full bg-muted py-1 text-muted-foreground transition-colors hover:bg-muted/80"
          >
            <span className="block h-1 w-12 rounded-full bg-muted-foreground/50" />
          </button>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <div className="inline-flex items-center gap-1 rounded-full border bg-muted/60 p-1">
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
              <p className="text-xs text-muted-foreground sm:hidden">{bottomSheetHint}</p>
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
                size="sm"
                className="flex items-center gap-1"
                onClick={toggleExplorer}
              >
                {isExplorerFullscreen ? "退出全屏" : isExplorerOpen ? "收起" : "展开"}
                {isExplorerOpen ? (
                  <ChevronDown className={cn("h-4 w-4", isDraggingExplorer && "animate-pulse")} aria-hidden />
                ) : (
                  <ChevronRight className="h-4 w-4" aria-hidden />
                )}
              </Button>
            </div>
          </div>
          <p className="mt-2 hidden text-xs text-muted-foreground sm:block">{bottomSheetHint}</p>
        </div>
        <div className="relative flex-1 overflow-hidden px-4 pb-5 pt-4">
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
                  <div className="flex h-full gap-3 overflow-hidden pb-3">
                    {columnOrder.map((columnId) => {
                      const data = columnComputed[columnId];
                      const isColumnActive = activeColumn === columnId;
                      const columnView = data.view;
                      const columnCanGoUp =
                        normalizeForCompare(columnView.directoryPath) !== normalizedProjectPath ||
                        columnView.stack.length > 0;
                      return (
                        <div
                          key={columnId}
                          className={cn(
                            "flex min-w-0 flex-1 flex-col gap-2 py-2 transition",
                            isColumnActive
                              ? "bg-primary/5 shadow-[0_8px_16px_-12px_rgba(37,99,235,0.45)]"
                              : "hover:bg-muted/10",
                          )}
                          onMouseDown={() => setActiveColumn(columnId)}
                        >
                          <div className="no-scrollbar flex-1 overflow-y-auto">
                            <div className="divide-y divide-border">
                              <button
                                type="button"
                                onClick={() => {
                                  if (!columnCanGoUp) {
                                    return;
                                  }
                                  setActiveColumn(columnId);
                                  goToParentDirectoryForColumn(columnId);
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
                                      columnCanGoUp ? "text-primary" : "text-muted-foreground",
                                    )}
                                    aria-hidden
                                  />
                                  <span className="truncate font-medium text-foreground">..</span>
                                </span>
                                <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                              </button>
                              {data.nodes.length === 0 ? (
                                <div className="px-3 py-3 text-xs text-muted-foreground">该目录为空</div>
                              ) : (
                                data.nodes.map((node) => {
                                  const isActiveFile = node.type === "file" && node.path === activeFilePath;
                                  return (
                                    <button
                                      key={node.path}
                                      type="button"
                                      onClick={(event) => handleEntryClick(event, columnId, node)}
                                      onPointerDown={(event) => handleEntryPointerDown(event, columnId, node)}
                                      onPointerUp={handleEntryPointerUp}
                                      onPointerCancel={handleEntryPointerUp}
                                      onPointerLeave={handleEntryPointerUp}
                                      onContextMenu={(event) => handleEntryContextMenu(event, columnId, node)}
                                      className={cn(
                                        "flex w-full items-center justify-between gap-3 pr-3 pl-0 py-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                        isActiveFile ? "bg-primary/10 text-primary" : "hover:bg-muted",
                                      )}
                                    >
                                      <span className="flex flex-1 items-center gap-3">
                                        {node.type === "folder" ? (
                                          <Folder className="h-4 w-4 text-primary" aria-hidden />
                                        ) : (
                                          <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
                                        )}
                                        <span className="truncate font-medium text-foreground">{node.name}</span>
                                      </span>
                                      {node.type === "folder" ? (
                                        <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                                      ) : null}
                                    </button>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
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
        </div>
      </section>
      <Dialog open={isEntryActionDialogOpen} onOpenChange={handleEntryActionDialogOpenChange}>
        <DialogContent className="max-w-sm" showCloseButton={!isProcessingEntryAction}>
          {entryActionContext
            ? (() => {
                const targetColumn: ColumnId = entryActionContext.columnId === "left" ? "right" : "left";
                const targetDirectoryPath = columnViews[targetColumn]?.directoryPath ?? projectPath;
                const targetDirectoryDisplay = getDisplayPath(targetDirectoryPath, projectPath);
                const entryLabel = entryActionContext.node.type === "folder" ? "文件夹" : "文件";

                if (pendingEntryAction === "rename") {
                  return (
                    <div className="space-y-5">
                      <DialogHeader className="items-center text-center">
                        <DialogTitle className="text-lg font-semibold">重命名</DialogTitle>
                        <DialogDescription className="text-sm">
                          当前{entryLabel}：
                          <span className="ml-1 font-medium text-foreground">{entryActionContext.node.name}</span>
                        </DialogDescription>
                      </DialogHeader>
                      <form className="space-y-5" onSubmit={handleRenameEntrySubmit}>
                        <Input
                          value={renameEntryName}
                          onChange={(event) => setRenameEntryName(event.target.value)}
                          disabled={isProcessingEntryAction}
                          autoFocus
                        />
                        {entryActionError ? (
                          <p className="text-sm text-destructive">{entryActionError}</p>
                        ) : null}
                        <DialogFooter>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                              if (!isProcessingEntryAction) {
                                setPendingEntryAction(null);
                                setEntryActionError(null);
                                setRenameEntryName(entryActionContext.node.name);
                              }
                            }}
                            disabled={isProcessingEntryAction}
                          >
                            返回
                          </Button>
                          <Button type="submit" disabled={isProcessingEntryAction}>
                            {isProcessingEntryAction ? "提交中…" : "确认重命名"}
                          </Button>
                        </DialogFooter>
                      </form>
                    </div>
                  );
                }

                return (
                  <div className="space-y-5">
                    <DialogHeader className="items-center text-center">
                      <DialogTitle className="text-lg font-semibold">选择操作</DialogTitle>
                      <DialogDescription className="text-sm">
                        {entryLabel}：
                        <span className="ml-1 font-medium text-foreground">{entryActionContext.node.name}</span>
                      </DialogDescription>
                    </DialogHeader>
                    {entryActionError ? (
                      <p className="text-sm text-destructive">{entryActionError}</p>
                    ) : null}
                    {(() => {
                      const ArrowIcon = entryActionContext.columnId === "left" ? ArrowRight : ArrowLeft;
                      const arrowLabel = entryActionContext.columnId === "left" ? "→" : "←";

                      return (
                        <div className="grid grid-cols-2 gap-3">
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                              setPendingEntryAction("rename");
                              setRenameEntryName(entryActionContext.node.name);
                              setEntryActionError(null);
                            }}
                            disabled={isProcessingEntryAction}
                            className="h-20 flex-col items-start justify-center gap-1 rounded-xl border bg-accent/40 px-4 text-left text-sm font-semibold shadow-sm transition hover:bg-accent"
                          >
                            <Pencil className="h-5 w-5 text-muted-foreground" />
                            <span>重命名</span>
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => handleCopyOrMove("copy")}
                            disabled={isProcessingEntryAction}
                            className="h-20 flex-col items-start justify-center gap-1 rounded-xl border bg-accent/40 px-4 text-left text-sm font-semibold shadow-sm transition hover:bg-accent"
                          >
                            <ArrowIcon className="h-5 w-5 text-muted-foreground" />
                            <span>复制&nbsp;{arrowLabel}</span>
                            <span className="text-xs font-normal text-muted-foreground">目标：{targetDirectoryDisplay}</span>
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => handleCopyOrMove("move")}
                            disabled={isProcessingEntryAction}
                            className="h-20 flex-col items-start justify-center gap-1 rounded-xl border bg-accent/40 px-4 text-left text-sm font-semibold shadow-sm transition hover:bg-accent"
                          >
                            <ArrowIcon className="h-5 w-5 text-muted-foreground" />
                            <span>移动&nbsp;{arrowLabel}</span>
                            <span className="text-xs font-normal text-muted-foreground">目标：{targetDirectoryDisplay}</span>
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={handleDeleteEntry}
                            disabled={isProcessingEntryAction}
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
      <Dialog open={isCreateEntryDialogOpen} onOpenChange={handleCreateDialogOpenChange}>
        <DialogContent className="max-w-md" showCloseButton={!isCreatingEntry}>
          <DialogHeader>
            <DialogTitle>新建文件或文件夹</DialogTitle>
            <DialogDescription>
              将在当前目录 <span className="font-medium text-foreground">{activeDirectoryDisplayPath}</span>
              内创建新条目。
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-5" onSubmit={handleCreateEntrySubmit}>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={createEntryType === "file" ? "default" : "outline"}
                onClick={() => setCreateEntryType("file")}
                disabled={isCreatingEntry}
              >
                新建文件
              </Button>
              <Button
                type="button"
                variant={createEntryType === "folder" ? "default" : "outline"}
                onClick={() => setCreateEntryType("folder")}
                disabled={isCreatingEntry}
              >
                新建文件夹
              </Button>
            </div>
            <div className="space-y-2">
              <Input
                value={createEntryName}
                onChange={(event) => setCreateEntryName(event.target.value)}
                placeholder={createEntryType === "file" ? "例如：index.html" : "例如：assets"}
                autoFocus
                disabled={isCreatingEntry}
              />
              {createEntryError ? (
                <p className="text-sm text-destructive">{createEntryError}</p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleCreateDialogOpenChange(false)}
                disabled={isCreatingEntry}
              >
                取消
              </Button>
              <Button
                type="submit"
                disabled={isCreatingEntry || createEntryName.trim().length === 0}
              >
                {isCreatingEntry ? "创建中…" : "确认创建"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ProjectWorkspace;
