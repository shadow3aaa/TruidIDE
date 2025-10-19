import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import CodeMirror from "@uiw/react-codemirror";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { xml } from "@codemirror/lang-xml";
import { EditorView } from "@codemirror/view";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, FileText, Folder } from "lucide-react";

import type { FileNode, ProjectEntry } from "@/types/project";

type ProjectWorkspaceProps = {
  project: ProjectEntry;
  onBackHome: () => void;
};

type BottomTab = "files" | "preview";

const BOTTOM_TABS: Array<{ id: BottomTab; label: string }> = [
  { id: "files", label: "文件管理" },
  { id: "preview", label: "实时预览" },
];

function FileLeaf({
  node,
  level = 0,
  activePath,
  onFileSelect,
}: {
  node: FileNode;
  level?: number;
  activePath?: string | null;
  onFileSelect?: (node: FileNode) => void;
}) {
  const isActive = activePath === node.path;

  return (
    <button
      type="button"
      onClick={() => onFileSelect?.(node)}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isActive
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted",
      )}
      style={{ paddingLeft: level * 16 + 24 }}
      title={node.path}
    >
      <FileText className="h-4 w-4" aria-hidden />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

function FolderNode({
  node,
  level = 0,
  activePath,
  onFileSelect,
}: {
  node: FileNode;
  level?: number;
  activePath?: string | null;
  onFileSelect?: (node: FileNode) => void;
}) {
  const [isOpen, setIsOpen] = useState(level < 1);

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ paddingLeft: level * 16 + 8 }}
      >
        <span className="flex items-center gap-2">
          {isOpen ? (
            <ChevronDown className="h-4 w-4" aria-hidden />
          ) : (
            <ChevronRight className="h-4 w-4" aria-hidden />
          )}
          <Folder className="h-4 w-4 text-primary" aria-hidden />
          <span className="truncate font-medium" title={node.path}>
            {node.name}
          </span>
        </span>
      </button>
      {isOpen && node.children?.length ? (
        <div className="space-y-1">
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              level={level + 1}
              activePath={activePath}
              onFileSelect={onFileSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FileTreeNode({
  node,
  level = 0,
  activePath,
  onFileSelect,
}: {
  node: FileNode;
  level?: number;
  activePath?: string | null;
  onFileSelect?: (node: FileNode) => void;
}) {
  if (node.type === "folder") {
    return (
      <FolderNode
        node={node}
        level={level}
        activePath={activePath}
        onFileSelect={onFileSelect}
      />
    );
  }

  return (
    <FileLeaf node={node} level={level} activePath={activePath} onFileSelect={onFileSelect} />
  );
}

function FileTree({
  nodes,
  activePath,
  onFileSelect,
}: {
  nodes: FileNode[];
  activePath?: string | null;
  onFileSelect?: (node: FileNode) => void;
}) {
  return (
    <div className="space-y-1">
      {nodes.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          level={0}
          activePath={activePath}
          onFileSelect={onFileSelect}
        />
      ))}
    </div>
  );
}

function ProjectWorkspace({ project, onBackHome }: ProjectWorkspaceProps) {
  const [isExplorerOpen, setExplorerOpen] = useState(true);
  const [isExplorerFullscreen, setExplorerFullscreen] = useState(false);
  const DEFAULT_EXPANDED_HEIGHT = 360;
  const [explorerHeight, setExplorerHeight] = useState(DEFAULT_EXPANDED_HEIGHT);
  const [isDraggingExplorer, setDraggingExplorer] = useState(false);
  const explorerHandleRef = useRef<HTMLButtonElement | null>(null);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [isLoadingFileTree, setIsLoadingFileTree] = useState(false);
  const [fileTreeError, setFileTreeError] = useState<string | null>(null);
  const [fileTreeVersion, setFileTreeVersion] = useState(0);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [isLoadingFileContent, setIsLoadingFileContent] = useState(false);
  const [fileContentError, setFileContentError] = useState<string | null>(null);
  const [fileContentVersion, setFileContentVersion] = useState(0);
  const saveTimerRef = useRef<number | null>(null);
  const [activeBottomTab, setActiveBottomTab] = useState<BottomTab>("files");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewReloadToken, setPreviewReloadToken] = useState(0);
  const activeBottomTabRef = useRef(activeBottomTab);

  useEffect(() => {
    activeBottomTabRef.current = activeBottomTab;
  }, [activeBottomTab]);

  const requestPreviewReload = useCallback(() => {
    setPreviewReloadToken((token) => token + 1);
  }, []);

  const COLLAPSED_HEIGHT = 76;
  const MIN_SHEET_HEIGHT = 180;

  const clampExplorerHeight = useCallback((value: number) => {
    const viewportHeight = window.innerHeight || 720;
    const maxSheetHeight = Math.max(MIN_SHEET_HEIGHT, Math.floor(viewportHeight * 0.75));
    return Math.min(Math.max(value, MIN_SHEET_HEIGHT), maxSheetHeight);
  }, []);

  const projectPath = project.path;

  useEffect(() => {
    if (activeBottomTab !== "preview" && isExplorerFullscreen) {
      setExplorerFullscreen(false);
      setExplorerHeight(clampExplorerHeight(DEFAULT_EXPANDED_HEIGHT));
    }
  }, [activeBottomTab, isExplorerFullscreen, clampExplorerHeight, DEFAULT_EXPANDED_HEIGHT]);

  useEffect(() => {
    if (!isExplorerFullscreen) {
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
  }, [isExplorerFullscreen]);

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
  }, [projectPath, clampExplorerHeight, DEFAULT_EXPANDED_HEIGHT]);

  useEffect(() => {
    if (!isExplorerOpen) {
      setExplorerFullscreen(false);
      setExplorerHeight(COLLAPSED_HEIGHT);
      return;
    }

    if (isExplorerFullscreen) {
      const viewportHeight = window.innerHeight || 720;
      setExplorerHeight(viewportHeight);
    }
  }, [isExplorerOpen, isExplorerFullscreen, COLLAPSED_HEIGHT]);

  const startExplorerDrag = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();

      const allowFullscreen = activeBottomTabRef.current === "preview";
      const viewportHeight = window.innerHeight || 720;

      const startY = event.clientY;
      const startHeight = explorerHeight;
      let latestHeight = startHeight;
      setDraggingExplorer(true);
      setExplorerOpen(true);
      setExplorerFullscreen(false);

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const delta = startY - moveEvent.clientY;
        const desiredHeight = startHeight + delta;
        const boundedHeight = allowFullscreen
          ? Math.min(Math.max(desiredHeight, MIN_SHEET_HEIGHT), viewportHeight)
          : clampExplorerHeight(desiredHeight);
        latestHeight = boundedHeight;
        setExplorerHeight(boundedHeight);
      };

      const handlePointerUp = () => {
        explorerHandleRef.current?.releasePointerCapture(event.pointerId);
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        setDraggingExplorer(false);

        const settledHeight = allowFullscreen
          ? Math.min(Math.max(latestHeight, MIN_SHEET_HEIGHT), viewportHeight)
          : clampExplorerHeight(latestHeight);

        if (allowFullscreen) {
          const fullscreenThreshold = Math.max(
            MIN_SHEET_HEIGHT,
            Math.floor(viewportHeight * 0.88),
          );
          if (settledHeight >= fullscreenThreshold) {
            setExplorerFullscreen(true);
            setExplorerOpen(true);
            setExplorerHeight(viewportHeight);
            return;
          }
        }

        setExplorerFullscreen(false);

        if (settledHeight <= COLLAPSED_HEIGHT + 32) {
          setExplorerOpen(false);
          setExplorerHeight(COLLAPSED_HEIGHT);
        } else {
          setExplorerOpen(true);
          setExplorerHeight(settledHeight);
        }
      };

      explorerHandleRef.current?.setPointerCapture(event.pointerId);
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [clampExplorerHeight, explorerHeight, COLLAPSED_HEIGHT, MIN_SHEET_HEIGHT],
  );

  const toggleExplorer = () => {
    setExplorerOpen((prev) => {
      const next = !prev;
      if (!next) {
        setExplorerFullscreen(false);
        setExplorerHeight(COLLAPSED_HEIGHT);
      } else {
        setExplorerFullscreen(false);
        setExplorerHeight(clampExplorerHeight(DEFAULT_EXPANDED_HEIGHT));
      }
      return next;
    });
  };

  const refreshFileTree = useCallback(() => {
    setFileTreeVersion((token) => token + 1);
  }, []);

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
  }, [projectPath, fileTreeVersion]);

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

    const normalize = (value: string) => {
      const withoutUnc = value.startsWith("\\\\?\\") ? value.slice(4) : value;
      return withoutUnc.replace(/[\\/]+$/, "").replace(/\\+/g, "/");
    };

    const filePathNormalized = normalize(activeFilePath);
    const projectRootNormalized = normalize(projectPath);

    if (filePathNormalized.toLowerCase().startsWith(projectRootNormalized.toLowerCase())) {
      const relative = filePathNormalized.slice(projectRootNormalized.length).replace(/^\/+/, "");
      if (relative.length > 0) {
        return `./${relative}`;
      }
      return `./${activeFileName ?? ""}`;
    }

    return filePathNormalized;
  }, [activeFilePath, projectPath, activeFileName]);

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
            <div className="h-full overflow-y-auto rounded-xl border bg-card p-4 shadow-sm">
              {isLoadingFileTree ? (
                <p className="text-sm text-muted-foreground">正在读取项目结构…</p>
              ) : fileTreeError ? (
                <div className="space-y-3">
                  <p className="text-sm text-destructive">{fileTreeError}</p>
                  <Button size="sm" variant="outline" onClick={refreshFileTree}>
                    重试
                  </Button>
                </div>
              ) : fileTree.length === 0 ? (
                <p className="text-sm text-muted-foreground">此项目中暂时没有可显示的文件。</p>
              ) : (
                <FileTree nodes={fileTree} activePath={activeFilePath} onFileSelect={handleFileSelect} />
              )}
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
    </div>
  );
}

export default ProjectWorkspace;
