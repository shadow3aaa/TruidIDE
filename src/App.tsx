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
import { Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import HomePage from "@/pages/HomePage";
import ProjectWorkspace from "@/pages/ProjectWorkspace";
import PluginsPage from "@/pages/PluginsPage";
import { ProotDownloadProgress } from "@/components/ProotDownloadProgress";
import type { ProjectEntry } from "@/types/project";
import { invoke } from "@tauri-apps/api/core";
import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";

type CreateProjectRequest = {
  template_id: string;
  name: string;
};

type CreateProjectResponse = {
  project: ProjectEntry;
};

const projectTemplates = [
  {
    id: "basic-web",
    name: "基础 Web 模板",
    description: "适用于预览简单 Web 页面的模板。",
  },
];

function App() {
  const [isProjectDialogOpen, setProjectDialogOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [isCreateDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [createProjectError, setCreateProjectError] = useState<string | null>(
    null,
  );
  const [createdProject, setCreatedProject] = useState<ProjectEntry | null>(
    null,
  );
  const [projectName, setProjectName] = useState("基础工程");
  const [projectToOpen, setProjectToOpen] = useState<ProjectEntry | null>(null);
  const [activeProject, setActiveProject] = useState<ProjectEntry | null>(null);

  const navigate = useNavigate();
  const handleOpenPlugins = useCallback(() => {
    navigate("/plugins");
  }, [navigate]);

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
      return;
    }

    if (!projectToOpen && sortedProjects.length > 0) {
      setProjectToOpen(sortedProjects[0]);
    }
  }, [isProjectDialogOpen, projectToOpen, sortedProjects]);

  useEffect(() => {
    if (!isCreateDialogOpen) {
      setSelectedTemplate(null);
      setCreateProjectError(null);
      setCreatedProject(null);
      setIsCreatingProject(false);
      setProjectName("基础工程");
      return;
    }

    if (!selectedTemplate && projectTemplates.length > 0) {
      setSelectedTemplate(projectTemplates[0].id);
    }
  }, [isCreateDialogOpen, selectedTemplate]);

  const handleOpenProject = () => {
    if (!projectToOpen) {
      return;
    }

    setActiveProject(projectToOpen);
    setProjectDialogOpen(false);
    navigate("/projects/current");
  };

  const handleBackHome = () => {
    setActiveProject(null);
    navigate("/");
  };

  const handleCreateProject = async () => {
    if (!selectedTemplate) {
      setCreateProjectError("请选择一个模板");
      return;
    }

    const name = projectName.trim();
    if (!name) {
      setCreateProjectError("请输入项目名称");
      return;
    }

    setIsCreatingProject(true);
    setCreateProjectError(null);

    try {
      const response = await invoke<CreateProjectResponse>("create_project", {
        request: {
          template_id: selectedTemplate,
          name,
        } satisfies CreateProjectRequest,
      });

      setCreatedProject(response.project);
      setProjects((prev) => {
        const withoutCurrent = prev.filter(
          (item) => item.path !== response.project.path,
        );
        return [response.project, ...withoutCurrent];
      });
      setProjectName(response.project.name);
      setProjectToOpen(response.project);
    } catch (error) {
      const message =
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "创建项目失败";
      setCreateProjectError(message);
    } finally {
      setIsCreatingProject(false);
    }
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
              onOpenProjectDialog={() => setProjectDialogOpen(true)}
              onOpenCreateDialog={() => setCreateDialogOpen(true)}
              onOpenPlugins={handleOpenPlugins}
            />
          }
        />
        <Route path="/plugins" element={<PluginsPage />} />
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

      <Dialog open={isProjectDialogOpen} onOpenChange={setProjectDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>打开项目</DialogTitle>
            <DialogDescription>
              从应用的私有目录中选择一个项目继续工作。
            </DialogDescription>
          </DialogHeader>
          <section className="space-y-3">
            {isLoadingProjects ? (
              <p className="text-sm text-muted-foreground">正在加载项目列表…</p>
            ) : projectsError ? (
              <p className="text-sm text-destructive">{projectsError}</p>
            ) : sortedProjects.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                暂无项目。您可以稍后从文件系统导入或创建新的安卓工程。
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
                          // prevent click immediately after long-press
                          if (projectLongPressTriggeredRef.current) {
                            projectLongPressTriggeredRef.current = false;
                            e.preventDefault();
                            e.stopPropagation();
                            return;
                          }
                          setProjectToOpen(project);
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
                            <span className="text-xs text-primary">已选择</span>
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
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">取消</Button>
            </DialogClose>
            <Button onClick={handleOpenProject} disabled={!projectToOpen}>
              打开项目
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

      <Dialog open={isCreateDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>创建项目</DialogTitle>
            <DialogDescription>选择一个模板以快速开始。</DialogDescription>
          </DialogHeader>
          {createdProject ? (
            <section className="space-y-3">
              <p className="text-sm text-muted-foreground">
                项目已创建：您可以返回主页在“打开”列表中找到它。
              </p>
              <article className="rounded-lg border bg-card p-4 text-card-foreground">
                <h3 className="text-base font-semibold">
                  {createdProject.name}
                </h3>
                <p className="mt-1 break-all text-xs text-muted-foreground">
                  {createdProject.path}
                </p>
                {createdProject.last_modified_secs ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    创建时间：
                    {new Date(
                      createdProject.last_modified_secs * 1000,
                    ).toLocaleString()}
                  </p>
                ) : null}
              </article>
            </section>
          ) : (
            <>
              <section className="grid gap-4 sm:grid-cols-2">
                {projectTemplates.map((template) => {
                  const isSelected = selectedTemplate === template.id;
                  return (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => setSelectedTemplate(template.id)}
                      className={cn(
                        "flex h-full flex-col justify-between rounded-lg border bg-card p-4 text-left text-card-foreground shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isSelected
                          ? "border-primary ring-2 ring-primary"
                          : "hover:border-primary hover:shadow",
                      )}
                    >
                      <div className="space-y-2">
                        <h3 className="text-base font-semibold">
                          {template.name}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {template.description}
                        </p>
                      </div>
                      <div className="mt-4 flex justify-between text-xs text-muted-foreground">
                        <span>{isSelected ? "已选择" : "点击选择"}</span>
                        <span>模板 ID：{template.id}</span>
                      </div>
                    </button>
                  );
                })}
              </section>
              <div className="mt-4 space-y-2">
                <label className="text-sm font-medium" htmlFor="project-name">
                  项目名称
                </label>
                <Input
                  id="project-name"
                  value={projectName}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setProjectName(event.target.value)
                  }
                  placeholder="请输入项目名称"
                />
              </div>
              {createProjectError ? (
                <p className="text-sm text-destructive">{createProjectError}</p>
              ) : null}
            </>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">
                {createdProject ? "关闭" : "取消"}
              </Button>
            </DialogClose>
            {!createdProject ? (
              <Button
                onClick={handleCreateProject}
                disabled={
                  isCreatingProject ||
                  !selectedTemplate ||
                  projectName.trim().length === 0
                }
              >
                {isCreatingProject ? "正在创建…" : "开始创建"}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default App;
