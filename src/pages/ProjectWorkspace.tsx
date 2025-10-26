import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Extension } from "@codemirror/state";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { xml } from "@codemirror/lang-xml";
import { EditorView } from "@codemirror/view";
import { Home, Menu, Puzzle, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createLspClient } from "@/lib/lsp";
import { listPlugins, startLspSession } from "@/lib/plugins";
import { cn } from "@/lib/utils";
import type { FileNode, ProjectEntry } from "@/types/project";
import type { PluginSummary } from "@/types/plugin";

import { CreateEntryDialog } from "./project-workspace/CreateEntryDialog";
import { EntryActionDialog } from "./project-workspace/EntryActionDialog";
import EditorPane from "./project-workspace/EditorPane";
import BottomExplorer from "./project-workspace/BottomExplorer";
import {
  COLUMN_IDS,
  type ColumnId,
  type ColumnState,
  type CreateEntryType,
  type BottomTabId,
} from "./project-workspace/types";
import type { PluginLogEntry } from "./project-workspace/PluginOutputPanel";
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

// collapsed height handled inside BottomExplorer

const ENABLE_LSP_DEBUG_LOGS = true;

type LspSessionRecord = {
  clientEntry: Awaited<ReturnType<typeof createLspClient>>;
  pluginId: string;
  languageId: string;
};

type LspStderrEventPayload = {
  sessionId?: string;
  pluginId?: string;
  languageId?: string;
  data?: string;
};

type LspExitEventPayload = {
  sessionId?: string;
  pluginId?: string;
  languageId?: string;
  statusCode?: number | null;
  signal?: number | null;
};

const MAX_PLUGIN_LOG_ENTRIES = 500;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

type ProjectWorkspaceProps = {
  project: ProjectEntry;
  onBackHome: () => void;
  onOpenPlugins: () => void;
};

function ProjectWorkspace({
  project,
  onBackHome,
  onOpenPlugins,
}: ProjectWorkspaceProps) {
  const projectPath = project.path;
  const normalizedProjectPath = useMemo(
    () => normalizeForCompare(projectPath),
    [projectPath],
  );

  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [isExplorerOpen, setExplorerOpen] = useState(false);
  const [activeBottomTab, setActiveBottomTab] = useState<BottomTabId>("files");

  const [fileTreeVersion, setFileTreeVersion] = useState(0);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [isLoadingFileTree, setIsLoadingFileTree] = useState(false);
  const [fileTreeError, setFileTreeError] = useState<string | null>(null);

  const [columnViews, setColumnViews] = useState<Record<ColumnId, ColumnState>>(
    () => ({
      left: createColumnState(projectPath),
      right: createColumnState(projectPath),
    }),
  );
  const [activeColumn, setActiveColumn] = useState<ColumnId>("left");

  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [isLoadingFileContent, setIsLoadingFileContent] = useState(false);
  const [fileContentError, setFileContentError] = useState<string | null>(null);
  const [fileContentVersion, setFileContentVersion] = useState(0);
  const saveTimerRef = useRef<number | null>(null);
  const [availablePlugins, setAvailablePlugins] = useState<PluginSummary[]>([]);
  const [lspExtensions, setLspExtensions] = useState<Extension[] | null>(null);
  const lspSessionsRef = useRef(new Map<string, LspSessionRecord>());
  const pendingLspSessionsRef = useRef(
    new Map<string, Promise<LspSessionRecord>>(),
  );
  const logIdCounterRef = useRef(0);
  const [pluginLogs, setPluginLogs] = useState<PluginLogEntry[]>([]);
  const appendPluginLog = useCallback((entry: Omit<PluginLogEntry, "id">) => {
    logIdCounterRef.current += 1;
    const fallbackId = `${Date.now()}-${logIdCounterRef.current}`;
    let uniqueId = fallbackId;
    const globalCrypto =
      typeof globalThis !== "undefined"
        ? (globalThis as { crypto?: Crypto }).crypto
        : undefined;
    if (globalCrypto && typeof globalCrypto.randomUUID === "function") {
      try {
        uniqueId = globalCrypto.randomUUID();
      } catch {
        uniqueId = fallbackId;
      }
    }
    setPluginLogs((prev) => {
      const next = [...prev, { ...entry, id: uniqueId }];
      if (next.length > MAX_PLUGIN_LOG_ENTRIES) {
        return next.slice(next.length - MAX_PLUGIN_LOG_ENTRIES);
      }
      return next;
    });
  }, []);
  const clearPluginLogs = useCallback(() => {
    setPluginLogs([]);
  }, []);
  const isMountedRef = useRef(true);
  const detectLanguageId = useCallback((filePath: string) => {
    const lower = filePath.toLowerCase();
    if (lower.endsWith(".ts") || lower.endsWith(".tsx")) {
      return "typescript";
    }
    if (lower.endsWith(".js") || lower.endsWith(".jsx")) {
      return "javascript";
    }
    if (lower.endsWith(".json")) {
      return "json";
    }
    if (lower.endsWith(".jsonc")) {
      return "jsonc";
    }
    if (lower.endsWith(".css")) {
      return "css";
    }
    if (lower.endsWith(".html") || lower.endsWith(".htm")) {
      return "html";
    }
    if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
      return "markdown";
    }
    if (lower.endsWith(".xml")) {
      return "xml";
    }
    if (lower.endsWith(".yml") || lower.endsWith(".yaml")) {
      return "yaml";
    }
    if (lower.endsWith(".py")) {
      return "python";
    }
    if (lower.endsWith(".java")) {
      return "java";
    }
    if (lower.endsWith(".rs")) {
      return "rust";
    }
    return "plaintext";
  }, []);
  const toFileUri = useCallback((filePath: string) => {
    const normalized = normalizeFsPath(filePath).replace(/\\/g, "/");
    if (/^[a-zA-Z]:\//.test(normalized)) {
      return encodeURI(`file:///${normalized}`);
    }
    if (normalized.startsWith("/")) {
      return encodeURI(`file://${normalized}`);
    }
    return encodeURI(`file://${normalized}`);
  }, []);
  const disposeLspSession = useCallback((key: string) => {
    const record = lspSessionsRef.current.get(key);
    if (!record) {
      if (ENABLE_LSP_DEBUG_LOGS) {
        console.debug("[LSP] disposeLspSession: 会话不存在", { key });
      }
      return;
    }
    if (ENABLE_LSP_DEBUG_LOGS) {
      console.debug("[LSP] disposeLspSession: 正在清理会话", {
        key,
        sessionId: record.clientEntry.sessionId,
      });
    }
    lspSessionsRef.current.delete(key);
    record.clientEntry.client.disconnect();
    void record.clientEntry.transport.shutdown();
  }, []);
  const ensureLspClient = useCallback(
    async (plugin: PluginSummary, languageId: string) => {
      const key = `${plugin.id}::${languageId}`;
      const existing = lspSessionsRef.current.get(key);
      if (existing) {
        return existing;
      }

      const pending = pendingLspSessionsRef.current.get(key);
      if (pending) {
        return pending;
      }

      const workspaceUri = toFileUri(projectPath);
      const defaultWorkspaceFolders = [
        {
          uri: workspaceUri,
          name: project.name,
        },
      ];

      const pendingPromise = (async () => {
        let sessionId: string | undefined;
        let resolvedLanguageId = languageId;
        try {
          const session = await startLspSession({
            pluginId: plugin.id,
            languageId,
            workspacePath: projectPath,
            workspaceFolders: defaultWorkspaceFolders,
          });
          sessionId = session.sessionId;
          resolvedLanguageId = session.languageId;
          if (ENABLE_LSP_DEBUG_LOGS) {
            console.debug("[LSP] start_lsp_session 成功", {
              pluginId: plugin.id,
              languageId: session.languageId,
              sessionId: session.sessionId,
            });
          }
          appendPluginLog({
            timestamp: Date.now(),
            level: "info",
            sessionId,
            pluginId: plugin.id,
            languageId: resolvedLanguageId,
            message: "会话已启动，等待初始化响应…",
          });

          const clientCapabilities =
            session.clientCapabilities &&
            typeof session.clientCapabilities === "object"
              ? (session.clientCapabilities as Record<string, unknown>)
              : undefined;

          const clientEntry = await createLspClient({
            sessionId: session.sessionId,
            rootUri: workspaceUri,
            clientCapabilities,
            initializationOptions: session.initializationOptions,
            workspaceFolders:
              session.workspaceFolders ?? defaultWorkspaceFolders,
            timeoutMs: LSP_REQUEST_TIMEOUT_MS,
            pathMapping: session.pathMapping || null,
          });

          appendPluginLog({
            timestamp: Date.now(),
            level: "info",
            sessionId,
            pluginId: plugin.id,
            languageId: resolvedLanguageId,
            message: "初始化成功",
          });

          const record: LspSessionRecord = {
            clientEntry,
            pluginId: plugin.id,
            languageId: session.languageId,
          };
          if (ENABLE_LSP_DEBUG_LOGS) {
            console.debug("[LSP] 会话已建立", {
              pluginId: plugin.id,
              languageId: session.languageId,
              sessionId: session.sessionId,
            });
          }
          lspSessionsRef.current.set(key, record);
          // 注意：不要在组件卸载时立即清理会话，因为组件可能会重新挂载（如底栏全屏）
          // 会话会在项目关闭或不再需要时通过 useEffect cleanup 清理
          return record;
        } catch (error) {
          appendPluginLog({
            timestamp: Date.now(),
            level: "stderr",
            sessionId: sessionId ?? "unknown",
            pluginId: plugin.id,
            languageId: resolvedLanguageId,
            message: `初始化失败：${getErrorMessage(error)}`,
          });
          throw error;
        }
      })();

      pendingLspSessionsRef.current.set(key, pendingPromise);
      try {
        return await pendingPromise;
      } finally {
        pendingLspSessionsRef.current.delete(key);
      }
    },
    [appendPluginLog, disposeLspSession, project.name, projectPath, toFileUri],
  );

  useEffect(() => {
    let disposed = false;

    const setup = async () => {
      if (!activeFilePath) {
        setLspExtensions(null);
        return;
      }

      const plugin = availablePlugins.find(
        (item) =>
          item.enabled !== false &&
          item.kind?.type === "lsp" &&
          Array.isArray(item.kind.languageIds) &&
          item.kind.languageIds.includes(detectLanguageId(activeFilePath)),
      );

      if (!plugin) {
        setLspExtensions(null);
        return;
      }

      try {
        const languageId = detectLanguageId(activeFilePath);
        if (ENABLE_LSP_DEBUG_LOGS) {
          console.debug("[LSP] 准备绑定插件扩展", {
            activeFilePath,
            pluginId: plugin.id,
            languageId,
          });
        }
        const record = await ensureLspClient(plugin, languageId);
        await record.clientEntry.client.initializing;
        if (disposed) {
          return;
        }
        const uri = toFileUri(activeFilePath);
        const pluginExtensions = record.clientEntry.client.plugin(
          uri,
          languageId,
        );
        const normalizedExtensions = (
          Array.isArray(pluginExtensions)
            ? pluginExtensions
            : [pluginExtensions]
        ).filter(Boolean) as Extension[];
        setLspExtensions(normalizedExtensions);
        if (ENABLE_LSP_DEBUG_LOGS) {
          console.debug("[LSP] 已应用插件扩展", {
            activeFilePath,
            pluginId: plugin.id,
            languageId,
            extensionCount: normalizedExtensions.length,
          });
        }
      } catch (error) {
        console.error("初始化 LSP 插件失败", error);
        if (!disposed) {
          setLspExtensions(null);
        }
      }
    };

    void setup();

    return () => {
      disposed = true;
    };
  }, [
    activeFilePath,
    availablePlugins,
    detectLanguageId,
    ensureLspClient,
    toFileUri,
  ]);

  useEffect(() => {
    let disposed = false;
    listPlugins()
      .then((plugins) => {
        if (!disposed) {
          setAvailablePlugins(plugins);
        }
      })
      .catch((error) => {
        console.error("获取插件列表失败", error);
      });

    let unlisten: (() => void) | undefined;
    listen<PluginSummary[]>("truidide://plugins/updated", (event) => {
      if (!disposed && Array.isArray(event.payload)) {
        setAvailablePlugins(event.payload);
      }
    })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch(() => {
        // ignore listener errors
      });

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const unlistenCallbacks: (() => void)[] = [];

    const attach = async () => {
      try {
        const stderrUnlisten = await listen<LspStderrEventPayload>(
          "truidide://lsp/stderr",
          (event) => {
            if (disposed || !event.payload) {
              return;
            }
            const payload = event.payload;
            appendPluginLog({
              timestamp: Date.now(),
              level: "stderr",
              sessionId: payload.sessionId ?? "unknown",
              pluginId: payload.pluginId ?? "unknown",
              languageId: payload.languageId ?? undefined,
              message: payload.data ?? "",
            });
          },
        );
        unlistenCallbacks.push(stderrUnlisten);
      } catch (error) {
        console.error("监听插件 stderr 失败", error);
      }

      try {
        const exitUnlisten = await listen<LspExitEventPayload>(
          "truidide://lsp/exit",
          (event) => {
            if (disposed || !event.payload) {
              return;
            }
            const payload = event.payload;
            const detailParts: string[] = [];
            if (
              payload.statusCode !== undefined &&
              payload.statusCode !== null
            ) {
              detailParts.push(`退出码 ${payload.statusCode}`);
            }
            if (payload.signal !== undefined && payload.signal !== null) {
              detailParts.push(`信号 ${payload.signal}`);
            }
            appendPluginLog({
              timestamp: Date.now(),
              level: "info",
              sessionId: payload.sessionId ?? "unknown",
              pluginId: payload.pluginId ?? "unknown",
              languageId: payload.languageId ?? undefined,
              message:
                detailParts.length > 0
                  ? `会话结束（${detailParts.join(" / ")}）`
                  : "会话结束",
            });
          },
        );
        unlistenCallbacks.push(exitUnlisten);
      } catch (error) {
        console.error("监听插件退出失败", error);
      }
    };

    void attach();

    return () => {
      disposed = true;
      while (unlistenCallbacks.length > 0) {
        const unlisten = unlistenCallbacks.pop();
        if (!unlisten) {
          continue;
        }
        try {
          unlisten();
        } catch (error) {
          console.warn("取消插件输出监听失败", error);
        }
      }
    };
  }, [appendPluginLog]);

  useEffect(() => {
    const enabledIds = new Set(
      availablePlugins
        .filter((item) => item.enabled !== false)
        .map((item) => item.id),
    );

    for (const [key, record] of lspSessionsRef.current.entries()) {
      if (!enabledIds.has(record.pluginId)) {
        disposeLspSession(key);
      }
    }
  }, [availablePlugins, disposeLspSession]);

  // 当项目路径变化时（即切换到不同项目），清理所有旧的 LSP 会话
  useEffect(() => {
    return () => {
      // 项目切换或组件最终卸载时，清理所有 LSP 会话
      if (ENABLE_LSP_DEBUG_LOGS) {
        console.debug("[LSP] 项目卸载，清理所有 LSP 会话");
      }
      for (const key of Array.from(lspSessionsRef.current.keys())) {
        disposeLspSession(key);
      }
    };
  }, [projectPath, disposeLspSession]); // projectPath 变化时会触发清理

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  type PreviewStatus = "idle" | "validating" | "ready" | "offline";

  const [previewAddressInput, setPreviewAddressInput] = useState("5173");
  const [previewAddressError, setPreviewAddressError] = useState<string | null>(
    null,
  );
  const [previewResolvedBaseUrl, setPreviewResolvedBaseUrl] = useState<
    string | null
  >(null);
  const [previewReloadToken, setPreviewReloadToken] = useState(0);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>("idle");
  const previewStorageKey = useMemo(
    () => `truidide:preview-target:${projectPath}`,
    [projectPath],
  );

  const previewResolvedUrl = useMemo(() => {
    if (!previewResolvedBaseUrl) {
      return null;
    }
    if (previewReloadToken <= 0) {
      return previewResolvedBaseUrl;
    }
    const separator = previewResolvedBaseUrl.includes("?") ? "&" : "?";
    return `${previewResolvedBaseUrl}${separator}__truidide=${previewReloadToken}`;
  }, [previewResolvedBaseUrl, previewReloadToken]);

  const resolvePreviewTarget = useCallback((raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      throw new Error("请输入要预览的端口号或完整地址");
    }

    const portMatch = trimmed.match(/^\d{1,5}$/);
    if (portMatch) {
      const portNumber = Number(trimmed);
      if (portNumber < 1 || portNumber > 65535) {
        throw new Error("端口号需在 1 到 65535 之间");
      }
      return `http://127.0.0.1:${portNumber}`;
    }

    const hostPortMatch = trimmed.match(
      /^(localhost|127\.0\.0\.1)(?::(\d{1,5}))$/i,
    );
    if (hostPortMatch) {
      const portNumber = Number(hostPortMatch[2]);
      if (portNumber < 1 || portNumber > 65535) {
        throw new Error("端口号需在 1 到 65535 之间");
      }
      return `http://${hostPortMatch[1]}:${portNumber}`;
    }

    if (/^https?:\/\//i.test(trimmed)) {
      try {
        const url = new URL(trimmed);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          throw new Error();
        }
        return url.toString();
      } catch {
        throw new Error("请输入有效的 http(s) 地址");
      }
    }

    throw new Error("请输入端口号或以 http:// 开头的地址");
  }, []);

  const handlePreviewAddressInputChange = useCallback(
    (value: string) => {
      setPreviewAddressInput(value);
      if (previewAddressError) {
        setPreviewAddressError(null);
      }
    },
    [previewAddressError],
  );

  const validatePreviewAddress = useCallback(
    async (resolved: string, persistValue?: string | null) => {
      if (typeof window === "undefined") {
        setPreviewResolvedBaseUrl(resolved);
        setPreviewReloadToken((token) => token + 1);
        return true;
      }

      setPreviewStatus("validating");
      setPreviewResolvedBaseUrl(resolved);

      if (persistValue) {
        try {
          window.localStorage.setItem(previewStorageKey, persistValue);
        } catch {
          // ignore storage access errors
        }
      }

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 5000);

      try {
        await fetch(resolved, {
          method: "GET",
          cache: "no-store",
          mode: "no-cors",
          signal: controller.signal,
        });
        window.clearTimeout(timeoutId);
        setPreviewReloadToken((token) => token + 1);
        return true;
      } catch {
        window.clearTimeout(timeoutId);
        setPreviewStatus("offline");
        return false;
      }
    },
    [previewStorageKey],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const stored = window.localStorage.getItem(previewStorageKey);
      if (stored) {
        setPreviewAddressInput(stored);
        try {
          const resolved = resolvePreviewTarget(stored);
          void validatePreviewAddress(resolved, undefined);
        } catch {
          setPreviewStatus("idle");
        }
      } else {
        setPreviewStatus("idle");
      }
    } catch {
      setPreviewStatus("idle");
    }
  }, [previewStorageKey, resolvePreviewTarget, validatePreviewAddress]);

  const handleApplyPreviewAddress = useCallback(() => {
    setPreviewAddressError(null);

    try {
      const trimmed = previewAddressInput.trim();
      const resolved = resolvePreviewTarget(previewAddressInput);
      void validatePreviewAddress(resolved, trimmed || null);
    } catch (error) {
      const message =
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "请输入有效的端口或地址";
      setPreviewAddressError(message);
    }
  }, [previewAddressInput, resolvePreviewTarget, validatePreviewAddress]);

  const requestPreviewReload = useCallback(() => {
    if (previewResolvedBaseUrl) {
      setPreviewAddressError(null);
      void validatePreviewAddress(previewResolvedBaseUrl, undefined);
      return;
    }

    handleApplyPreviewAddress();
  }, [
    previewResolvedBaseUrl,
    validatePreviewAddress,
    handleApplyPreviewAddress,
  ]);

  const handlePreviewFrameLoaded = useCallback(() => {
    setPreviewStatus((status) => (status === "validating" ? "ready" : status));
  }, []);

  const handlePreviewFrameError = useCallback(() => {
    setPreviewStatus("offline");
  }, []);

  const [isCreateEntryDialogOpen, setCreateEntryDialogOpen] = useState(false);
  const [createEntryType, setCreateEntryType] =
    useState<CreateEntryType>("file");
  const [createEntryName, setCreateEntryName] = useState("");
  const [createEntryError, setCreateEntryError] = useState<string | null>(null);
  const [isCreatingEntry, setCreatingEntry] = useState(false);

  const [entryActionContext, setEntryActionContext] = useState<{
    columnId: ColumnId;
    node: FileNode;
  } | null>(null);
  const [isEntryActionDialogOpen, setEntryActionDialogOpen] = useState(false);
  const [entryActionError, setEntryActionError] = useState<string | null>(null);
  const [pendingEntryAction, setPendingEntryAction] = useState<"rename" | null>(
    null,
  );
  const [renameEntryName, setRenameEntryName] = useState("");
  const [isProcessingEntryAction, setProcessingEntryAction] = useState(false);

  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  // ref to access CodeMirror editor instance
  const editorRef = useRef<any | null>(null);

  // insert text into editor at current selection, handling pair insertion
  const insertTextAtCursor = useCallback((text: string) => {
    const view = editorRef.current?.view ?? editorRef.current;
    if (!view) return;

    try {
      // For CodeMirror 6, view has state and dispatch
      const state = view.state;
      const sel = state.selection.main;

      // If text is a pair like () {} [] <> "" '' , insert both and place cursor between
      const pairs: Record<string, string> = {
        "(": ")",
        "[": "]",
        "{": "}",
        "<": ">",
        '"': '"',
        "'": "'",
      };

      const openChar = text;
      const closeChar = pairs[openChar];

      if (closeChar) {
        const changes = {
          from: sel.from,
          to: sel.to,
          insert: openChar + closeChar,
        };
        view.dispatch({
          changes,
          selection: { anchor: sel.from + 1 },
          scrollIntoView: true,
        });
      } else {
        // default: insert text at selection
        view.dispatch({
          changes: { from: sel.from, to: sel.to, insert: text },
          selection: { anchor: sel.from + text.length },
          scrollIntoView: true,
        });
      }

      const dom = view.dom || view.contentDOM || view.scrollDOM;
      if (dom && typeof dom.focus === "function") dom.focus();
    } catch (e) {
      // best-effort: fall back to inserting into textarea if available
      const cm = editorRef.current;
      if (cm && cm.editor) {
        try {
          const textarea = cm.editor.textarea as
            | HTMLTextAreaElement
            | undefined;
          if (textarea) {
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const value = textarea.value;
            const before = value.slice(0, start);
            const after = value.slice(end);
            textarea.value = before + text + after;
            const pos = start + text.length;
            textarea.setSelectionRange(pos, pos);
            textarea.focus();
          }
        } catch (err) {
          // ignore
        }
      }
    }
  }, []);

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
      if (
        event.source === window ||
        !event.data ||
        !("id" in event.data) ||
        !("cmd" in event.data)
      ) {
        return;
      }

      const { id, cmd, args } = event.data;
      const iframe = document.querySelector("iframe");
      if (!iframe || event.source !== iframe.contentWindow) {
        return;
      }

      try {
        const payload = await invoke(cmd, args);
        iframe.contentWindow?.postMessage({ id, payload }, "*");
      } catch (error) {
        iframe.contentWindow?.postMessage({ id, error }, "*");
      }
    };

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
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
    (
      event: React.PointerEvent<HTMLButtonElement>,
      columnId: ColumnId,
      node: FileNode,
    ) => {
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
    (
      event: React.MouseEvent<HTMLButtonElement>,
      columnId: ColumnId,
      node: FileNode,
    ) => {
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
  const suppressLoadingRef = React.useRef(false);
  const fetchIdRef = React.useRef<number | null>(null);
  const isFetchingRef = React.useRef(false);

  const refreshFileTree = useCallback((silent = false) => {
    if (silent) suppressLoadingRef.current = true;
    setFileTreeVersion((token) => token + 1);
  }, []);

  // Auto-refresh file tree when explorer is open and files tab is active.
  useEffect(() => {
    // Only poll while the explorer is open and files tab selected.
    if (!isExplorerOpen || activeBottomTab !== "files") return;

    let cancelled = false;
    const interval = window.setInterval(() => {
      if (cancelled) return;
      // Avoid triggering a refresh if a refresh is already running.
      if (!isLoadingFileTree && !isFetchingRef.current) {
        isFetchingRef.current = true;
        refreshFileTree(true); // silent
      }
    }, 1000);

    // Also refresh once when enabling auto-refresh (on open/switch to files)
    refreshFileTree(true);

    const onFocus = () => {
      if (!isLoadingFileTree) refreshFileTree(true);
    };
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [isExplorerOpen, activeBottomTab, isLoadingFileTree, refreshFileTree]);

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
    setPreviewAddressInput("5173");
    setPreviewResolvedBaseUrl(null);
    setPreviewReloadToken(0);
    setPreviewAddressError(null);
    setPreviewStatus("idle");
    setColumnViews({
      left: createColumnState(projectPath),
      right: createColumnState(projectPath),
    });
    setActiveColumn("left");
  }, [projectPath]);

  const columnOrder = useMemo<ColumnId[]>(() => COLUMN_IDS, []);

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
    [
      activeDirectoryPath,
      createEntryName,
      createEntryType,
      isCreatingEntry,
      refreshFileTree,
      resetCreateEntryForm,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    const currentFetchId = Date.now();
    // store active fetch id so only the latest toggles loading state
    fetchIdRef.current = currentFetchId;

    const wasSilent = suppressLoadingRef.current;
    if (!wasSilent) {
      setIsLoadingFileTree(true);
    }
    suppressLoadingRef.current = false;
    setFileTreeError(null);

    invoke<FileNode[]>("list_project_tree", { projectPath })
      .then((nodes) => {
        if (cancelled) return;
        setFileTree(nodes);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
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
        if (cancelled) return;
        // Only clear the loading indicator if this fetch is the most recent
        if (fetchIdRef.current === currentFetchId && !wasSilent) {
          setIsLoadingFileTree(false);
        }
        // clear isFetchingRef only if this is the latest fetch
        if (fetchIdRef.current === currentFetchId) {
          isFetchingRef.current = false;
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
    const extensions: Extension[] = [EditorView.lineWrapping];

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

    if (lspExtensions) {
      extensions.push(...lspExtensions);
    }

    return extensions;
  }, [activeFilePath, lspExtensions]);

  const activeFileDisplayPath = useMemo(() => {
    if (!activeFilePath) {
      return null;
    }

    const filePathNormalized = normalizeFsPath(activeFilePath);
    const projectRootNormalized = normalizeFsPath(projectPath);

    if (
      normalizeForCompare(filePathNormalized).startsWith(
        normalizeForCompare(projectRootNormalized),
      )
    ) {
      const relative = filePathNormalized
        .slice(projectRootNormalized.length)
        .replace(/^\/+/, "");
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
          normalizeForCompare(currentPath) === normalizedProjectPath &&
          currentView.stack.length === 0;

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
    (
      event: React.MouseEvent<HTMLButtonElement>,
      columnId: ColumnId,
      node: FileNode,
    ) => {
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
          normalizeForCompare(activeFilePath) ===
            normalizeForCompare(entryActionContext.node.path)
        ) {
          setActiveFilePath(null);
        }
      } else if (
        activeFilePath &&
        isPathWithin(activeFilePath, entryActionContext.node.path)
      ) {
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
  }, [
    activeFilePath,
    closeEntryActionDialog,
    entryActionContext,
    refreshFileTree,
  ]);

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
            normalizeForCompare(activeFilePath) ===
              normalizeForCompare(entryActionContext.node.path)
          ) {
            const parentPath = getParentDirectoryPath(
              entryActionContext.node.path,
            );
            const renamedPath = joinFsPath(parentPath, trimmed);
            setActiveFilePath(renamedPath);
          }
        } else if (
          activeFilePath &&
          isPathWithin(activeFilePath, entryActionContext.node.path)
        ) {
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
    [
      activeFilePath,
      closeEntryActionDialog,
      entryActionContext,
      refreshFileTree,
      renameEntryName,
    ],
  );

  const handleCopyOrMove = useCallback(
    async (mode: "copy" | "move") => {
      if (!entryActionContext) {
        return;
      }

      const otherColumn: ColumnId =
        entryActionContext.columnId === "left" ? "right" : "left";
      const targetDirectoryPath =
        columnViews[otherColumn]?.directoryPath ?? projectPath;

      setProcessingEntryAction(true);
      setEntryActionError(null);

      try {
        const command =
          mode === "copy" ? "copy_project_entry" : "move_project_entry";
        await invoke(command, {
          sourcePath: entryActionContext.node.path,
          targetDirectoryPath,
        });

        if (mode === "move") {
          if (entryActionContext.node.type === "file") {
            if (
              activeFilePath &&
              normalizeForCompare(activeFilePath) ===
                normalizeForCompare(entryActionContext.node.path)
            ) {
              const destinationPath = joinFsPath(
                targetDirectoryPath,
                entryActionContext.node.name,
              );
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
    [
      activeFilePath,
      closeEntryActionDialog,
      columnViews,
      entryActionContext,
      projectPath,
      refreshFileTree,
    ],
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

  const handleOpenPlugins = useCallback(() => {
    onOpenPlugins();
    setSidebarOpen(false);
  }, [onOpenPlugins, setSidebarOpen]);
  // removed local isFilesTab; BottomExplorer uses activeBottomTab

  const handleEditorChange = (value: string) => {
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
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
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
          <h1 className="truncate text-lg font-semibold text-foreground">
            {project.name}
          </h1>
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
          <Button
            type="button"
            variant="ghost"
            className="justify-start gap-2"
            onClick={handleOpenPlugins}
          >
            <Puzzle className="h-4 w-4" />
            插件
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
          <h2 className="truncate text-sm font-semibold text-foreground">
            {project.name}
          </h2>
        </div>

        {/* 桌面顶栏：显示项目标题与当前活动文件路径（作为副标题） */}
        <div className="hidden lg:flex items-center border-b bg-card/50 px-6 py-3">
          <div className="flex flex-col">
            <h1 className="truncate text-lg font-semibold text-foreground">
              {project.name}
            </h1>
            {activeFileDisplayPath ? (
              <p className="truncate text-sm text-muted-foreground mt-1">
                {activeFileDisplayPath}
              </p>
            ) : (
              <p className="truncate text-sm text-muted-foreground mt-1">
                请选择一个文件以开始编辑
              </p>
            )}
          </div>
        </div>

        <EditorPane
          activeFilePath={activeFilePath}
          fileContent={fileContent}
          isLoadingFileContent={isLoadingFileContent}
          fileContentError={fileContentError}
          editorExtensions={editorExtensions}
          onEditorChange={handleEditorChange}
          refreshFileContent={refreshFileContent}
          editorRef={editorRef}
          hasLspExtensions={lspExtensions !== null && lspExtensions.length > 0}
        />

        {isExplorerOpen && (
          <button
            type="button"
            aria-label="关闭底部面板"
            className="fixed inset-0 z-30 bg-background/70 backdrop-blur-sm"
            onClick={() => setExplorerOpen(false)}
          />
        )}

        <BottomExplorer
          isExplorerOpen={isExplorerOpen}
          setActiveBottomTab={setActiveBottomTab}
          activeBottomTab={activeBottomTab}
          isLoadingFileTree={isLoadingFileTree}
          toggleExplorer={toggleExplorer}
          previewAddressInput={previewAddressInput}
          onPreviewAddressInputChange={handlePreviewAddressInputChange}
          onApplyPreviewAddress={handleApplyPreviewAddress}
          previewAddressError={previewAddressError}
          previewResolvedBaseUrl={previewResolvedBaseUrl}
          previewResolvedUrl={previewResolvedUrl}
          canReloadPreview={
            Boolean(previewResolvedBaseUrl) && previewStatus !== "validating"
          }
          previewStatus={previewStatus}
          requestPreviewReload={requestPreviewReload}
          onPreviewFrameLoaded={handlePreviewFrameLoaded}
          onPreviewFrameError={handlePreviewFrameError}
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
          activeDirectoryDisplayPath={activeDirectoryDisplayPath}
          canGoToParent={canGoToParent}
          canGoToLastVisitedChild={canGoToLastVisitedChild}
          goToParentDirectory={goToParentDirectory}
          goToLastVisitedChildDirectory={goToLastVisitedChildDirectory}
          openCreateEntryDialog={openCreateEntryDialog}
          handleSwapColumns={handleSwapColumns}
          fileTree={fileTree}
          fileTreeError={fileTreeError}
          insertTextAtCursor={insertTextAtCursor}
          projectPath={projectPath}
          pluginLogs={pluginLogs}
          onClearPluginLogs={clearPluginLogs}
        />

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
const LSP_REQUEST_TIMEOUT_MS = 15_000;
