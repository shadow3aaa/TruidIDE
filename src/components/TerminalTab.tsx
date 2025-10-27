import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ChevronDown, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  projectPath: string;
};

const DEFAULT_TITLE = "终端";

type SessionInfo = {
  sessionId: string;
  title?: string | null;
  cwd: string;
};

type TerminalChunk = {
  seq: number;
  data: string;
};

export default function TerminalTab({ projectPath }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const attachTokenRef = useRef(0);
  const lastSeqRef = useRef<number>(0);
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const [sessionTitles, setSessionTitles] = useState<Record<string, string>>(
    {},
  );
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isCtrlLocked, setIsCtrlLocked] = useState(false);
  const [isAltLocked, setIsAltLocked] = useState(false);
  const ctrlLockedRef = useRef(isCtrlLocked);
  const altLockedRef = useRef(isAltLocked);
  const suppressNextDataRef = useRef(false);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    ctrlLockedRef.current = isCtrlLocked;
  }, [isCtrlLocked]);

  useEffect(() => {
    altLockedRef.current = isAltLocked;
  }, [isAltLocked]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    // Create terminal
    const term = new Terminal({
      cursorBlink: true,
      fontFamily:
        'MapleMonoNF, ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", "Courier New", monospace',
      fontSize: 13,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    termRef.current = term;
    fitRef.current = fit;

    // Use terminal-provided title sequences
    const titleDisposable = term.onTitleChange((nextTitle) => {
      const activeSid = sessionIdRef.current;
      if (!activeSid) return;
      const raw = typeof nextTitle === "string" ? nextTitle.trim() : "";
      setSessionTitles((prev) => {
        if (prev[activeSid] === raw) return prev;
        return { ...prev, [activeSid]: raw };
      });
      invoke("set_terminal_session_title", {
        args: { sessionId: activeSid, title: raw.length > 0 ? raw : null },
      }).catch(() => {});
    });

    const dataDisposable = term.onData((data) => {
      // Skip if a physical key was handled by onKey
      if (suppressNextDataRef.current) {
        suppressNextDataRef.current = false;
        return;
      }
      const activeSid = sessionIdRef.current;
      if (!activeSid) return;
      
      let payload = data;
      const ctrlLocked = ctrlLockedRef.current;
      const altLocked = altLockedRef.current;

      if ((ctrlLocked || altLocked) && data.length === 1) {
        let modified = data;
        if (ctrlLocked) {
          const upper = data.toUpperCase();
          if (upper >= "A" && upper <= "Z") {
            modified = String.fromCharCode(upper.charCodeAt(0) - 64);
          } else if (data === " ") {
            modified = "\u0000";
          }
        }
        if (altLocked) {
          modified = `\u001b${modified}`;
        }
        payload = modified;
        if (ctrlLocked) {
          ctrlLockedRef.current = false;
          setIsCtrlLocked(false);
        }
        if (altLocked) {
          altLockedRef.current = false;
          setIsAltLocked(false);
        }
      }
      invoke("send_terminal_input", {
        args: { sessionId: activeSid, input: payload },
      }).catch(() => {});
    });

    // Intercept physical keyboard input for sticky Ctrl/Alt
    const keyDisposable = term.onKey(({ domEvent }) => {
      const activeSid = sessionIdRef.current;
      if (!activeSid) return;
      
      const k = domEvent.key;
      // Only handle single-character printable keys
      if (
        typeof k === "string" &&
        k.length === 1 &&
        (ctrlLockedRef.current || altLockedRef.current)
      ) {
        let payload = k;
        // apply ctrl
        if (ctrlLockedRef.current) {
          const upper = k.toUpperCase();
          if (upper >= "A" && upper <= "Z") {
            payload = String.fromCharCode(upper.charCodeAt(0) - 64);
          } else if (k === " ") {
            payload = "\u0000";
          }
        }
        // apply alt (prefix ESC)
        if (altLockedRef.current) {
          payload = `\u001b${payload}`;
        }

        // prevent duplicate handling by xterm's default
        domEvent.preventDefault();
        domEvent.stopPropagation();

        // mark that the next onData event should be ignored
        suppressNextDataRef.current = true;

        // send payload to backend terminal
        invoke("send_terminal_input", {
          args: { sessionId: activeSid, input: payload },
        }).catch(() => {});

        // reset sticky modifiers
        setIsCtrlLocked(false);
        setIsAltLocked(false);
      }
    });

    // Helper: resolve CSS variable to color with RGBA support
    function resolveVar(varName: string, fallback = ""): string {
      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue(varName)
        .trim();
      return raw || fallback;
    }

    function toRgba(color: string, alpha: number): string {
      const m = color.match(/rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/);
      if (m) {
        return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})`;
      }
      return color;
    }

    // Build and apply xterm theme from CSS variables
    const applyComputedTheme = (t: Terminal) => {
      const background = resolveVar("--card", "#000");
      const foreground = resolveVar("--card-foreground", "#fff");
      const primary = resolveVar("--color-primary", foreground);
      const destructive = resolveVar("--destructive", "#ff5f6d");

      t.options.theme = {
        background,
        foreground,
        cursor: primary,
        selectionBackground: toRgba(primary, 0.12),
        black: resolveVar("--color-background", "#000"),
        red: destructive,
        green: resolveVar("--chart-4", "#8bd46f"),
        yellow: resolveVar("--chart-5", "#ffd166"),
        blue: primary,
        magenta: resolveVar("--chart-3", "#c792ea"),
        cyan: resolveVar("--chart-2", "#66d9ef"),
        white: foreground,
        brightBlack: resolveVar("--color-muted", "#6b7280"),
        brightRed: destructive,
        brightGreen: resolveVar("--chart-4", "#8bd46f"),
        brightYellow: resolveVar("--chart-5", "#ffd166"),
        brightBlue: resolveVar("--sidebar-primary", primary),
        brightMagenta: resolveVar("--chart-3", "#c792ea"),
        brightCyan: resolveVar("--chart-2", "#66d9ef"),
        brightWhite: resolveVar("--color-foreground", foreground),
      };
    };

    // Open terminal and apply theme
    term.open(containerRef.current!);
    fit.fit();
    applyComputedTheme(term);

    const handleResize = () => {
      fit.fit();
      const activeSessionId = sessionIdRef.current;
      if (activeSessionId && term.cols && term.rows) {
        invoke("resize_terminal", {
          args: { sessionId: activeSessionId, cols: term.cols, rows: term.rows },
        }).catch(() => {});
      }
    };

    window.addEventListener("resize", handleResize);

    // Observe theme changes on the document
    const themeObserver = new MutationObserver(() => {
      if (termRef.current) applyComputedTheme(termRef.current);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    if (document.body) {
      themeObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ["class"],
      });
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      themeObserver.disconnect();
      term.dispose();
      keyDisposable.dispose();
      dataDisposable.dispose();
      titleDisposable.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getDisplayName = useCallback(
    (sessionId: string, index: number) => {
      const raw = sessionTitles[sessionId];
      if (raw && raw.trim().length > 0) {
        return raw.trim();
      }
      if (sessionIds.length > 1) {
        return `${DEFAULT_TITLE} ${index + 1}`;
      }
      return DEFAULT_TITLE;
    },
    [sessionTitles, sessionIds],
  );

  const refreshSessions = useCallback(async () => {
    try {
      const infos = await invoke<SessionInfo[]>("list_terminal_sessions", {
        cwd: projectPath,
      });
      if (!isMountedRef.current) return [] as string[];
      const ids = infos.map((info) => info.sessionId);
      const nextTitles: Record<string, string> = {};
      for (const info of infos) {
        const raw = typeof info.title === "string" ? info.title : "";
        nextTitles[info.sessionId] = raw ? raw.trim() : "";
      }
      setSessionIds(ids);
      setSessionTitles(nextTitles);
      return ids;
    } catch (error) {
      if (isMountedRef.current) {
        setSessionIds([]);
        setSessionTitles({});
      }
      const term = termRef.current;
      if (term) {
        term.writeln("无法获取终端会话：" + String(error));
      }
      return [];
    }
  }, [projectPath]);

  const detachCurrentSession = useCallback(async () => {
    const current = sessionIdRef.current;
    if (!current) return;
    
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
    sessionIdRef.current = null;
    lastSeqRef.current = 0;
    
    await invoke("detach_terminal_session", { args: { sessionId: current } }).catch(() => {});
  }, []);

  const attachToSession = useCallback(
    async (sessionId: string) => {
      const term = termRef.current;
      if (!term) return;

      if (sessionIdRef.current === sessionId) {
        setActiveSessionId(sessionId);
        setIsMenuOpen(false);
        term.focus();
        return;
      }

      const token = attachTokenRef.current + 1;
      attachTokenRef.current = token;

      await detachCurrentSession();

      const handler = (event: any) => {
        if (attachTokenRef.current !== token) return;
        const payload = event.payload;
        if (!payload) return;
        const seq = typeof payload.seq === "number" ? payload.seq : NaN;
        const data = typeof payload.data === "string" ? payload.data : String(payload);
        if (!Number.isNaN(seq) && seq > lastSeqRef.current) {
          term.write(data);
          lastSeqRef.current = seq;
        }
      };

      const unlisten = await listen(`terminal-output-${sessionId}`, handler);

      if (attachTokenRef.current !== token) {
        unlisten();
        return;
      }

      sessionIdRef.current = sessionId;
      unlistenRef.current = unlisten;
      lastSeqRef.current = 0;

      const snapshot = await invoke<TerminalChunk[]>(
        "attach_terminal_session",
        { args: { sessionId } },
      );
      
      if (attachTokenRef.current === token && sessionIdRef.current === sessionId) {
        term.reset();
        for (const item of snapshot) {
          if (typeof item.seq === "number" && item.seq > lastSeqRef.current) {
            term.write(item.data);
            lastSeqRef.current = item.seq;
          }
        }
      }

      if (attachTokenRef.current !== token || sessionIdRef.current !== sessionId) {
        return;
      }

      setActiveSessionId(sessionId);
      setIsMenuOpen(false);
      term.focus();

      fitRef.current?.fit();
      const cols = term.cols;
      const rows = term.rows;
      if (cols && rows) {
        await invoke("resize_terminal", {
          args: { sessionId, cols, rows },
        });
      }
    },
    [detachCurrentSession],
  );

  const createSession = useCallback(
    async (forceNew: boolean) => {
      try {
        const sid: string = await invoke("start_terminal_session", {
          args: { cwd: projectPath, forceNew: forceNew },
        });
        const ids = await refreshSessions();
        if (!isMountedRef.current) return null;
        if (forceNew) {
          if (ids.includes(sid)) return sid;
          return ids[ids.length - 1] ?? null;
        }
        if (ids.includes(sid)) return sid;
        return ids[0] ?? null;
      } catch (error) {
        const term = termRef.current;
        if (term) {
          term.writeln("无法启动终端会话：" + String(error));
        }
        return null;
      }
    },
    [projectPath, refreshSessions],
  );

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      setIsMenuOpen(false);
      await attachToSession(sessionId);
    },
    [attachToSession],
  );

  const handleCreateSession = useCallback(async () => {
    setIsMenuOpen(false);
    const newId = await createSession(true);
    if (newId) {
      await attachToSession(newId);
    }
  }, [attachToSession, createSession]);

  const handleCloseSession = useCallback(
    async (sessionId: string) => {
      setIsMenuOpen(false);
      if (sessionIdRef.current === sessionId) {
        await detachCurrentSession();
      }
      try {
        await invoke("stop_terminal_session", { args: { sessionId } });
      } catch (error) {
        const term = termRef.current;
        if (term) {
          term.writeln("终止终端失败：" + String(error));
        }
      }
      const ids = await refreshSessions();
      if (!isMountedRef.current) return;
      let nextId = ids.find((id) => id !== sessionId) ?? null;
      if (!nextId) {
        nextId = await createSession(false);
      }
      if (nextId) {
        await attachToSession(nextId);
      } else {
        setActiveSessionId(null);
      }
    },
    [attachToSession, createSession, detachCurrentSession, refreshSessions],
  );

  useEffect(() => {
    if (!isMenuOpen) return;
    const handlePointer = (event: MouseEvent | TouchEvent) => {
      const container = menuContainerRef.current;
      if (!container) return;
      if (!container.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("touchstart", handlePointer);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("touchstart", handlePointer);
    };
  }, [isMenuOpen]);

  useEffect(() => {
    if (!isMenuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

  useEffect(() => {
    setIsMenuOpen(false);
    setActiveSessionId(null);
    setSessionIds([]);
    setSessionTitles({});
    let disposed = false;

    const boot = async () => {
      await detachCurrentSession();
      if (disposed || !isMountedRef.current) return;
      const ids = await refreshSessions();
      if (disposed || !isMountedRef.current) return;
      let targetId: string | null = ids.length > 0 ? ids[0] : null;
      if (!targetId) {
        targetId = await createSession(false);
      }
      if (!targetId || disposed || !isMountedRef.current) return;
      await attachToSession(targetId);
    };

    boot();

    return () => {
      disposed = true;
      detachCurrentSession().catch(() => {});
    };
  }, [
    projectPath,
    attachToSession,
    createSession,
    detachCurrentSession,
    refreshSessions,
  ]);

  useEffect(() => {
    if (!activeSessionId) {
      setIsCtrlLocked(false);
      setIsAltLocked(false);
    }
  }, [activeSessionId]);

  const sendTerminalInput = useCallback(async (input: string) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    termRef.current?.focus();
    try {
      await invoke("send_terminal_input", {
        args: { sessionId, input },
      });
    } catch {
      // no-op: best effort fire-and-forget
    }
  }, []);

  const handleSequenceClick = useCallback(
    (sequence: string) => {
      void sendTerminalInput(sequence);
    },
    [sendTerminalInput],
  );

  // termux风格两排布局，按钮大小统一，顺序参考termux
  // 两排各 10 个按钮，倒 T 形箭头布局：UP 在第一排的索引 4，第二排索引 4 为 DOWN，左右在 3/5。
  // PGUP/PGDN 在同一列（索引 8）上下对齐。
  const termuxRows = useMemo(
    () => [
      [
        { id: "esc", label: "ESC", type: "seq", sequence: "\u001b" },
        { id: "alt", label: "ALT", type: "alt" },
        { id: "arrow-up", label: "↑", type: "seq", sequence: "\u001b[A" },
        { id: "tab", label: "TAB", type: "seq", sequence: "\t" },
        { id: "pgup", label: "PGUP", type: "seq", sequence: "\u001b[5~" },
        { id: "home", label: "HOME", type: "seq", sequence: "\u001b[H" },
      ],
      [
        { id: "ctrl", label: "CTRL", type: "ctrl" },
        { id: "arrow-left", label: "←", type: "seq", sequence: "\u001b[D" },
        { id: "arrow-down", label: "↓", type: "seq", sequence: "\u001b[B" },
        { id: "arrow-right", label: "→", type: "seq", sequence: "\u001b[C" },
        { id: "pgdn", label: "PGDN", type: "seq", sequence: "\u001b[6~" },
        { id: "end", label: "END", type: "seq", sequence: "\u001b[F" },
      ],
    ],
    [],
  );

  const hasActiveSession = Boolean(activeSessionId);

  const activeDisplayTitle = useMemo(() => {
    if (!activeSessionId) return DEFAULT_TITLE;
    const raw = sessionTitles[activeSessionId];
    if (raw && raw.trim().length > 0) {
      return raw.trim();
    }
    const index = sessionIds.findIndex((id) => id === activeSessionId);
    if (index >= 0) {
      if (sessionIds.length > 1) {
        return `${DEFAULT_TITLE} ${index + 1}`;
      }
      return DEFAULT_TITLE;
    }
    return DEFAULT_TITLE;
  }, [activeSessionId, sessionIds, sessionTitles]);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center border-b px-2 py-2">
        <div ref={menuContainerRef} className="relative w-full">
          <button
            type="button"
            onClick={() => setIsMenuOpen((prev) => !prev)}
            className={cn(
              "flex w-full items-center justify-between rounded-md border bg-card px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              isMenuOpen ? "ring-1 ring-ring" : "hover:border-muted",
            )}
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
          >
            <span className="truncate" title={activeDisplayTitle}>
              {activeDisplayTitle}
            </span>
            <ChevronDown
              className={cn(
                "ml-2 h-4 w-4 transition-transform",
                isMenuOpen && "rotate-180",
              )}
              aria-hidden
            />
          </button>
          {isMenuOpen && (
            <div className="absolute left-0 top-full z-20 mt-2 w-64 rounded-md border bg-card shadow-lg">
              <div className="max-h-64 overflow-y-auto py-1" role="menu">
                {sessionIds.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    暂无终端会话
                  </div>
                ) : (
                  sessionIds.map((id, index) => {
                    const display = getDisplayName(id, index);
                    const isActive = id === activeSessionId;
                    return (
                      <div key={id} className="flex items-center">
                        <button
                          type="button"
                          role="menuitem"
                          className={cn(
                            "flex-1 truncate px-3 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                            isActive
                              ? "bg-muted font-medium text-foreground"
                              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                          )}
                          onClick={() => handleSelectSession(id)}
                          title={display}
                        >
                          {display}
                        </button>
                        <button
                          type="button"
                          aria-label="关闭终端"
                          className={cn(
                            "px-2 py-2 text-muted-foreground transition hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                            isActive && "text-destructive",
                          )}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleCloseSession(id);
                          }}
                        >
                          <X className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="border-t px-1 py-1">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                  onClick={handleCreateSession}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  <span>新建终端</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <div ref={containerRef} className="flex-1 overflow-hidden bg-card" />
      {/* termux 风格两排卡片式快捷栏 */}
      <div className="border-t border-border/60 bg-muted/40 p-0 select-none">
        <div className="flex flex-col items-center w-full p-0 m-0 gap-0">
          {termuxRows.map((row, rowIdx) => (
            <div
              key={rowIdx}
              className="flex flex-row w-full p-0 m-0 gap-0"
              style={{ borderSpacing: 0 }}
            >
              {row.map((item) => {
                // termux风格：每个按钮等分宽度
                const baseClass =
                  "truid-termux-key flex-1 flex items-center justify-center h-8 m-0 bg-white text-[11px] font-medium select-none transition active:scale-95 cursor-pointer";
                const disabledClass = !hasActiveSession
                  ? "opacity-50 pointer-events-none"
                  : "";
                const highlightClass =
                  (item.type === "ctrl" && isCtrlLocked) ||
                  (item.type === "alt" && isAltLocked)
                    ? "truid-termux-key-active"
                    : "";
                const handleClick = () => {
                  if (!hasActiveSession) return;
                  if (item.type === "ctrl") setIsCtrlLocked((prev) => !prev);
                  else if (item.type === "alt") setIsAltLocked((prev) => !prev);
                  else if (item.type === "seq")
                    handleSequenceClick(item.sequence!);
                  termRef.current?.focus();
                };
                return (
                  <div
                    key={item.id}
                    className={cn(baseClass, highlightClass, disabledClass)}
                    tabIndex={0}
                    role="button"
                    aria-pressed={
                      item.type === "ctrl"
                        ? isCtrlLocked
                        : item.type === "alt"
                          ? isAltLocked
                          : undefined
                    }
                    aria-label={item.label}
                    title={item.label}
                    onClick={handleClick}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleClick();
                      }
                    }}
                    style={{ minWidth: 0 }}
                  >
                    {item.label}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {/* termux风格卡片按钮样式 */}
        <style>{`
          .truid-termux-key {
            background: #fff;
            border: none;
            border-radius: 0;
            box-shadow: none;
            margin: 0;
            user-select: none;
            touch-action: manipulation;
            transition: background 0.15s, color 0.15s, transform 0.1s;
            min-width: 0;
            min-height: 24px;
            max-height: 28px;
            font-size: 11px;
            letter-spacing: 0.01em;
            font-family: inherit;
            font-weight: 500;
            text-align: center;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            color: #222;
          }
          .truid-termux-key:active {
            background: #f3f3f3;
            transform: scale(0.97);
          }
          .truid-termux-key-active {
            background: #111 !important;
            color: #fff !important;
          }
        `}</style>
      </div>
    </div>
  );
}
