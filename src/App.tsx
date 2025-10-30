import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProjectPreviewExplorer } from "@/components/ProjectPreviewExplorer";
import { open } from "@tauri-apps/plugin-dialog";
import { platform } from "@tauri-apps/plugin-os";
import { Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import HomePage from "@/pages/HomePage";
import ProjectWorkspace from "@/pages/ProjectWorkspace";
import PluginsPage from "@/pages/PluginsPage";
import TerminalPage from "@/pages/TerminalPage";
import { ProotDownloadProgress } from "@/components/ProotDownloadProgress";
import type { ProjectEntry } from "@/types/project";
import { invoke } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";

function App() {
  const RECENT_FOLDERS_KEY = "truidide:recent-folders";
  const [isProjectDialogOpen, setProjectDialogOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [projectToOpen, setProjectToOpen] = useState<ProjectEntry | null>(null);
  const [activeProject, setActiveProject] = useState<ProjectEntry | null>(null);
  const [isAndroid, setIsAndroid] = useState(false);
  const [projectsRootPath, setProjectsRootPath] = useState<string | null>(null);
  const [isLoadingProjectsRoot, setIsLoadingProjectsRoot] = useState(false);
  const [selectedDirectoryPath, setSelectedDirectoryPath] = useState<
    string | null
  >(null);
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [isRecentMenuOpen, setRecentMenuOpen] = useState(false);

  const navigate = useNavigate();
  const handleOpenPlugins = useCallback(() => {
    navigate("/plugins");
  }, [navigate]);

  const recordRecentFolder = useCallback((path: string) => {
    setRecentFolders((prev) => {
      const normalized = path.trim();
      if (!normalized) {
        return prev;
      }
      const next = [normalized, ...prev.filter((item) => item !== normalized)];
      if (next.length > 50) {
        next.length = 50;
      }
      return next;
    });
  }, []);

  const handleExplorerDirectorySelect = useCallback((rawPath: string) => {
    const trimmed = rawPath.trim();
    setSelectedDirectoryPath(trimmed.length > 0 ? trimmed : null);
  }, []);

  const openWorkspaceAtPath = useCallback(
    (rawPath: string, hint?: ProjectEntry | null) => {
      if (!rawPath) {
        return;
      }

      const normalizedPath = rawPath.trim();
      if (!normalizedPath) {
        return;
      }

      const name =
        normalizedPath.split(/[/\\]/).filter(Boolean).pop() ?? "项目";

      const entry: ProjectEntry =
        hint && hint.path === normalizedPath
          ? hint
          : {
              name,
              path: normalizedPath,
              last_modified_secs: null,
            };

      recordRecentFolder(normalizedPath);
      setActiveProject(entry);
      setProjectDialogOpen(false);
      setSelectedDirectoryPath(null);
      setProjectToOpen(null);
      navigate("/projects/current");
    },
    [navigate, recordRecentFolder],
  );

  const openFolderWithDialog = useCallback(async () => {
    try {
      const selection = await open({
        directory: true,
        multiple: false,
      });

      const selectedPath = Array.isArray(selection) ? selection[0] : selection;
      if (typeof selectedPath !== "string" || selectedPath.length === 0) {
        return;
      }

      openWorkspaceAtPath(selectedPath);
    } catch {
      // silently ignore cancellation or errors
    }
  }, [openWorkspaceAtPath]);

  const handleOpenFolder = useCallback(() => {
    if (isAndroid) {
      setProjectDialogOpen(true);
      return;
    }

    setRecentMenuOpen(true);
  }, [isAndroid]);

  const handleOpenTerminal = useCallback(() => {
    navigate("/terminal");
  }, [navigate]);

  const openRecentPath = useCallback(
    (path: string) => {
      const trimmed = typeof path === "string" ? path.trim() : "";
      if (!trimmed) {
        return;
      }
      setRecentMenuOpen(false);
      recordRecentFolder(trimmed);
      openWorkspaceAtPath(trimmed);
    },
    [openWorkspaceAtPath, recordRecentFolder],
  );

  useEffect(() => {
    try {
      const value = platform();
      setIsAndroid(value === "android");
    } catch {
      setIsAndroid(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const stored = window.localStorage.getItem(RECENT_FOLDERS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const sanitized = parsed
            .map((item) => (typeof item === "string" ? item.trim() : ""))
            .filter((item) => item.length > 0)
            .slice(0, 50);
          if (sanitized.length > 0) {
            setRecentFolders(sanitized);
          }
        }
      }
    } catch {
      // ignore corrupted storage
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(
        RECENT_FOLDERS_KEY,
        JSON.stringify(recentFolders),
      );
    } catch {
      // ignore persistence errors
    }
  }, [recentFolders]);

  useEffect(() => {
    if (!isProjectDialogOpen) {
      return;
    }

    let cancelled = false;
    setIsLoadingProjects(true);
    setProjectsError(null);

    invoke<ProjectEntry[]>("list_projects")
      .then((result) => {
        if (!cancelled) {
          setProjects(result);
        }
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
              : "获取项目列表失败";
        setProjectsError(message);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingProjects(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isProjectDialogOpen]);

  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      const aTime = a.last_modified_secs ?? 0;
      const bTime = b.last_modified_secs ?? 0;
      return bTime - aTime;
    });
  }, [projects]);

  useEffect(() => {
    if (!isProjectDialogOpen) {
      setProjectToOpen(null);
      setSelectedDirectoryPath(null);
      setProjectsRootPath(null);
      return;
    }

    if (isAndroid) {
      setProjectToOpen(null);
      return;
    }

    if (!projectToOpen && sortedProjects.length > 0) {
      const first = sortedProjects[0];
      setProjectToOpen(first);
      void handleExplorerDirectorySelect(first.path);
      return;
    }

    if (
      projectToOpen &&
      selectedDirectoryPath !== projectToOpen.path
    ) {
      void handleExplorerDirectorySelect(projectToOpen.path);
    }
  }, [
    isAndroid,
    isProjectDialogOpen,
    projectToOpen,
    selectedDirectoryPath,
    sortedProjects,
    handleExplorerDirectorySelect,
  ]);

  useEffect(() => {
    if (!isAndroid || !isProjectDialogOpen) {
      return;
    }

    setIsLoadingProjectsRoot(true);
    invoke<string>("get_projects_root")
      .then((root) => {
        setProjectsRootPath(root);
        void handleExplorerDirectorySelect(root);
      })
      .catch(() => {
        setProjectsRootPath(null);
        setSelectedDirectoryPath(null);
      })
      .finally(() => {
        setIsLoadingProjectsRoot(false);
      });
  }, [handleExplorerDirectorySelect, isAndroid, isProjectDialogOpen]);

  const previewRootPath = isProjectDialogOpen
    ? isAndroid
      ? projectsRootPath
      : projectToOpen?.path ?? null
    : null;
  const explorerSelectedPath = isProjectDialogOpen
    ? selectedDirectoryPath ??
      (isAndroid ? previewRootPath ?? null : projectToOpen?.path ?? null)
    : null;
  const effectiveSelectedPath = isProjectDialogOpen
    ? selectedDirectoryPath ??
      (isAndroid ? previewRootPath : projectToOpen?.path ?? null)
    : null;
  const isExplorerLoading =
    isProjectDialogOpen && isAndroid && isLoadingProjectsRoot;
  const explorerUnavailableText = isAndroid
    ? "无法加载工作目录，请稍后重试"
    : "请选择左侧的项目";
  const shouldShowUnavailable =
    isProjectDialogOpen && !isExplorerLoading && !previewRootPath;

  const handleOpenProject = () => {
    const targetPath = effectiveSelectedPath ?? projectToOpen?.path;
    if (!targetPath) {
      return;
    }

    openWorkspaceAtPath(targetPath, projectToOpen);
  };

  const handleBackHome = () => {
    setActiveProject(null);
    navigate("/");
  };

  // Project action dialog (long-press / context menu) state
  const [projectActionContext, setProjectActionContext] =
    useState<ProjectEntry | null>(null);
  const [isProjectActionDialogOpen, setProjectActionDialogOpen] =
    useState(false);
  const [projectActionError, setProjectActionError] = useState<string | null>(
    null,
  );
  const [pendingProjectAction, setPendingProjectAction] = useState<
    "rename" | null
  >(null);
  const [renameProjectName, setRenameProjectName] = useState("");
  const [isProcessingProjectAction, setProcessingProjectAction] =
    useState(false);

  const projectLongPressTimerRef = useRef<number | null>(null);
  const projectLongPressTriggeredRef = useRef(false);

  const cancelProjectLongPress = useCallback(() => {
    if (projectLongPressTimerRef.current !== null) {
      window.clearTimeout(projectLongPressTimerRef.current);
      projectLongPressTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => cancelProjectLongPress();
  }, [cancelProjectLongPress]);

  const openProjectActionDialog = useCallback((project: ProjectEntry) => {
    setProjectActionContext(project);
    setRenameProjectName(project.name);
    setProjectActionDialogOpen(true);
    setPendingProjectAction(null);
    setProjectActionError(null);
  }, []);

  const closeProjectActionDialog = useCallback(() => {
    if (isProcessingProjectAction) return;
    setProjectActionDialogOpen(false);
    setProjectActionContext(null);
    setPendingProjectAction(null);
    setProjectActionError(null);
    setRenameProjectName("");
  }, [isProcessingProjectAction]);

  const handleProjectPointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, project: ProjectEntry) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      cancelProjectLongPress();
      projectLongPressTriggeredRef.current = false;
      projectLongPressTimerRef.current = window.setTimeout(() => {
        projectLongPressTriggeredRef.current = true;
        openProjectActionDialog(project);
      }, 450);
    },
    [cancelProjectLongPress, openProjectActionDialog],
  );

  const handleProjectPointerUp = useCallback(
    (_event: React.PointerEvent<HTMLButtonElement>) => {
      cancelProjectLongPress();
    },
    [cancelProjectLongPress],
  );

  const handleProjectContextMenu = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, project: ProjectEntry) => {
      event.preventDefault();
      cancelProjectLongPress();
      projectLongPressTriggeredRef.current = false;
      openProjectActionDialog(project);
    },
    [cancelProjectLongPress, openProjectActionDialog],
  );

  const refreshProjects = useCallback(() => {
    setIsLoadingProjects(true);
    setProjectsError(null);
    invoke<ProjectEntry[]>("list_projects")
      .then((result) => {
        setProjects(result);
      })
      .catch((error: unknown) => {
        const message =
          typeof error === "string"
            ? error
            : error instanceof Error
              ? error.message
              : "获取项目列表失败";
        setProjectsError(message);
      })
      .finally(() => setIsLoadingProjects(false));
  }, []);

  const handleDeleteProject = useCallback(async () => {
    if (!projectActionContext) return;

    setProcessingProjectAction(true);
    setProjectActionError(null);

    try {
      await invoke("delete_project_entry", { path: projectActionContext.path });

      // If the deleted project was selected to open, clear the selection
      setProjectToOpen((prev) =>
        prev?.path === projectActionContext.path ? null : prev,
      );

      // If active project is the same, unset and navigate home
      if (activeProject?.path === projectActionContext.path) {
        setActiveProject(null);
        navigate("/");
      }

      refreshProjects();
      closeProjectActionDialog();
    } catch (error) {
      const message =
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "删除失败";
      setProjectActionError(message);
    } finally {
      setProcessingProjectAction(false);
    }
  }, [
    projectActionContext,
    activeProject,
    closeProjectActionDialog,
    refreshProjects,
    navigate,
  ]);

  const handleStartRenameProject = useCallback(() => {
    if (!projectActionContext || isProcessingProjectAction) return;
    setPendingProjectAction("rename");
    setRenameProjectName(projectActionContext.name);
    setProjectActionError(null);
  }, [projectActionContext, isProcessingProjectAction]);

  const handleCancelRenameProject = useCallback(() => {
    if (!projectActionContext || isProcessingProjectAction) return;
    setPendingProjectAction(null);
    setProjectActionError(null);
    setRenameProjectName(projectActionContext.name);
  }, [projectActionContext, isProcessingProjectAction]);

  const handleSubmitRenameProject = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!projectActionContext) return;

      const trimmed = renameProjectName.trim();
      if (!trimmed) {
        setProjectActionError("名称不能为空");
        return;
      }

      if (trimmed === projectActionContext.name) {
        closeProjectActionDialog();
        return;
      }

      setProcessingProjectAction(true);
      setProjectActionError(null);

      try {
        await invoke("rename_project_entry", {
          path: projectActionContext.path,
          newName: trimmed,
        });

        // Refresh whole project list to pick up new names/paths
        refreshProjects();
        closeProjectActionDialog();
      } catch (error) {
        const message =
          typeof error === "string"
            ? error
            : error instanceof Error
              ? error.message
              : "重命名失败";
        setProjectActionError(message);
      } finally {
        setProcessingProjectAction(false);
      }
    },
    [
      projectActionContext,
      renameProjectName,
      closeProjectActionDialog,
      refreshProjects,
    ],
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Proot 资源下载进度组件 - 在 Android 平台自动显示 */}
      <ProotDownloadProgress />

      <Routes>
        <Route
          path="/"
          element={
            <HomePage
              onOpenFolder={handleOpenFolder}
              onOpenTerminal={handleOpenTerminal}
              onOpenPlugins={handleOpenPlugins}
            />
          }
        />
        <Route path="/plugins" element={<PluginsPage />} />
        <Route path="/terminal" element={<TerminalPage />} />
        <Route
          path="/projects/current"
          element={
            activeProject ? (
              <ProjectWorkspace
                project={activeProject}
                onBackHome={handleBackHome}
                onOpenPlugins={handleOpenPlugins}
              />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <Dialog open={isRecentMenuOpen} onOpenChange={setRecentMenuOpen}>
        <DialogContent className="sm:max-w-sm">
          <div className="max-h-60 overflow-y-auto pr-1">
            <div className="sticky top-0 z-10 bg-background pb-2">
              <Button
                className="w-full"
                onClick={() => {
                  setRecentMenuOpen(false);
                  void openFolderWithDialog();
                }}
              >
                打开文件夹
              </Button>
            </div>
            {recentFolders.length === 0 ? (
              <p className="px-1 py-3 text-sm text-muted-foreground">
                暂无最近打开的目录
              </p>
            ) : (
              <div className="flex flex-col gap-2 pb-2">
                {recentFolders.map((folder) => {
                  const name = folder.split(/[/\\]/).filter(Boolean).pop() ?? folder;
                  return (
                    <button
                      type="button"
                      key={folder}
                      onClick={() => openRecentPath(folder)}
                      className="w-full rounded-md border bg-card p-3 text-left text-sm transition hover:border-primary hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="font-medium text-foreground">{name}</div>
                      <div className="mt-1 break-all text-xs text-muted-foreground">{folder}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isProjectDialogOpen} onOpenChange={setProjectDialogOpen}>
        <DialogContent className="md:max-w-5xl">
          <DialogHeader>
            <DialogTitle>打开文件夹</DialogTitle>
            <DialogDescription>
              选择一个项目文件夹并在右侧预览其结构，然后开始开发。
            </DialogDescription>
          </DialogHeader>
          <div
            className={cn(
              "grid gap-6",
              !isAndroid && "md:grid-cols-[minmax(0,280px)_1fr]",
            )}
          >
            {!isAndroid ? (
              <section className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-muted-foreground">
                  最近项目
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={refreshProjects}
                  disabled={isLoadingProjects}
                >
                  刷新
                </Button>
              </div>
              {isLoadingProjects ? (
                <p className="text-sm text-muted-foreground">
                  正在加载项目列表…
                </p>
              ) : projectsError ? (
                <p className="text-sm text-destructive">{projectsError}</p>
              ) : sortedProjects.length === 0 ? (
                <p className="rounded-lg border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
                  暂未检测到项目文件夹。可以先在终端中创建或导入项目，随后返回此处打开。
                </p>
              ) : (
                <ul className="space-y-2">
                  {sortedProjects.map((project) => {
                    const isSelected = projectToOpen?.path === project.path;
                    return (
                      <li key={project.path}>
                        <button
                          type="button"
                          onClick={(e) => {
                    if (projectLongPressTriggeredRef.current) {
                      projectLongPressTriggeredRef.current = false;
                      e.preventDefault();
                      e.stopPropagation();
                      return;
                    }
                    setProjectToOpen(project);
                    void handleExplorerDirectorySelect(project.path);
                  }}
                          onPointerDown={(e) =>
                            handleProjectPointerDown(e as any, project)
                          }
                          onPointerUp={(e) => handleProjectPointerUp(e as any)}
                          onContextMenu={(e) =>
                            handleProjectContextMenu(e as any, project)
                          }
                          className={cn(
                            "w-full rounded-lg border bg-card p-4 text-left text-card-foreground transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            isSelected
                              ? "border-primary bg-primary/5 shadow"
                              : "hover:border-primary hover:shadow",
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-medium">
                              {project.name}
                            </div>
                            {isSelected ? (
                              <span className="text-xs text-primary">
                                已选择
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 break-all text-xs text-muted-foreground">
                            {project.path}
                          </div>
                          {project.last_modified_secs ? (
                            <div className="mt-1 text-xs text-muted-foreground">
                              最近修改：
                              {new Date(
                                project.last_modified_secs * 1000,
                              ).toLocaleString()}
                            </div>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              </section>
            ) : null}
            <section className="flex flex-col gap-3">
              {isExplorerLoading ? (
                <div className="flex h-72 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
                  正在加载工作目录…
                </div>
              ) : previewRootPath ? (
                <ProjectPreviewExplorer
                  projectPath={previewRootPath}
                  selectedDirectoryPath={
                    explorerSelectedPath ?? previewRootPath
                  }
                  onSelectDirectory={(path) =>
                    void handleExplorerDirectorySelect(path)
                  }
                />
              ) : shouldShowUnavailable ? (
                <div
                  className={cn(
                    "flex h-72 items-center justify-center rounded-xl px-4 text-sm",
                    isAndroid
                      ? "border border-destructive/40 bg-destructive/10 text-destructive"
                      : "border border-dashed text-muted-foreground",
                  )}
                >
                  {explorerUnavailableText}
                </div>
              ) : null}
              {isProjectDialogOpen ? (
                <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">将打开：</span>
                  <span className="ml-1 break-all">
                    {explorerSelectedPath ?? previewRootPath ?? "未选择任何目录"}
                  </span>
                </div>
              ) : null}
            </section>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">取消</Button>
            </DialogClose>
            <Button
              onClick={handleOpenProject}
              disabled={
                !effectiveSelectedPath ||
                isLoadingProjects ||
                (isAndroid && (isExplorerLoading || !previewRootPath))
              }
            >
              打开文件夹
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Project action dialog for long-press / context menu */}
      <Dialog
        open={isProjectActionDialogOpen}
        onOpenChange={(open) => {
          if (!open && isProcessingProjectAction) return;
          setProjectActionDialogOpen(open);
          if (!open) {
            setProjectActionContext(null);
            setPendingProjectAction(null);
            setProjectActionError(null);
            setRenameProjectName("");
          }
        }}
      >
        <DialogContent
          className="max-w-sm"
          showCloseButton={!isProcessingProjectAction}
        >
          {projectActionContext ? (
            pendingProjectAction === "rename" ? (
              <div className="space-y-5">
                <div className="items-center text-center">
                  <h3 className="text-lg font-semibold">重命名</h3>
                  <p className="text-sm">
                    当前项目：
                    <span className="ml-1 font-medium text-foreground">
                      {projectActionContext.name}
                    </span>
                  </p>
                </div>
                <form
                  className="space-y-5"
                  onSubmit={handleSubmitRenameProject}
                >
                  <Input
                    value={renameProjectName}
                    onChange={(e) => setRenameProjectName(e.target.value)}
                    autoFocus
                    disabled={isProcessingProjectAction}
                  />
                  {projectActionError ? (
                    <p className="text-sm text-destructive">
                      {projectActionError}
                    </p>
                  ) : null}
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={handleCancelRenameProject}
                      disabled={isProcessingProjectAction}
                    >
                      返回
                    </Button>
                    <Button type="submit" disabled={isProcessingProjectAction}>
                      {isProcessingProjectAction ? "提交中…" : "确认重命名"}
                    </Button>
                  </DialogFooter>
                </form>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="items-center text-center">
                  <h3 className="text-lg font-semibold">选择操作</h3>
                  <p className="text-sm">
                    项目：
                    <span className="ml-1 font-medium text-foreground">
                      {projectActionContext.name}
                    </span>
                  </p>
                </div>
                {projectActionError ? (
                  <p className="text-sm text-destructive">
                    {projectActionError}
                  </p>
                ) : null}
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleStartRenameProject}
                    disabled={isProcessingProjectAction}
                    className="h-20 flex-col items-start justify-center gap-1 rounded-xl border bg-accent/40 px-4 text-left text-sm font-semibold shadow-sm transition hover:bg-accent"
                  >
                    <Pencil className="h-5 w-5 text-muted-foreground" />
                    <span>重命名</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleDeleteProject}
                    disabled={isProcessingProjectAction}
                    className="h-20 flex-col items-start justify-center gap-1 rounded-xl border border-destructive/50 bg-destructive/5 px-4 text-left text-sm font-semibold text-destructive shadow-sm transition hover:bg-destructive/10"
                  >
                    <Trash2 className="h-5 w-5" />
                    <span>删除</span>
                  </Button>
                </div>
              </div>
            )
          ) : null}
        </DialogContent>
      </Dialog>

    </div>
  );
}

export default App;
