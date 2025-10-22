import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
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
  const [sessionTitles, setSessionTitles] = useState<Record<string, string>>({});
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    

    // Build a small initial theme using root-level CSS variables. This
    // is used to seed the terminal immediately so the renderer does not
    // draw with the default black background at first paint.
    const initialBackground = resolveVar("--color-card", resolveVar("--color-background", "#000"));
    const initialForeground = resolveVar("--color-card-foreground", resolveVar("--color-foreground", "#fff"));
    const initialPrimary = resolveVar("--color-primary", initialForeground);
    const initialTheme = {
      background: initialBackground,
      foreground: initialForeground,
      cursor: initialPrimary,
    } as any;

    // Create terminal with sensible monospace defaults and an initial
    // theme so the first paint uses app colors instead of solid black.
    const term = new Terminal({
      cursorBlink: true,
      fontFamily:
        'MapleMonoNF, ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", "Courier New", monospace',
      fontSize: 13,
      theme: initialTheme,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    termRef.current = term;
    fitRef.current = fit;

    // Use terminal-provided title sequences (like VSCode) instead of parsing stdin.
    const titleDisposable = term.onTitleChange((nextTitle) => {
      const activeSid = sessionIdRef.current;
      if (!activeSid) return;
      const raw = typeof nextTitle === "string" ? nextTitle.trim() : "";
      setSessionTitles((prev) => {
        const existing = prev[activeSid];
        if (existing === raw) return prev;
        return { ...prev, [activeSid]: raw };
      });
      invoke("set_terminal_session_title", {
        args: {
          sessionId: activeSid,
          title: raw.length > 0 ? raw : null,
        },
      }).catch(() => {});
    });

    const dataDisposable = term.onData((data) => {
      const activeSid = sessionIdRef.current;
      if (!activeSid) return;
      invoke("send_terminal_input", {
        args: {
          sessionId: activeSid,
          input: data,
        },
      }).catch(() => {});
    });

    // Helper: resolve a CSS variable to a computed RGB(A) string by
    // creating a tiny hidden element and reading its computed style.
    function resolveVar(varName: string, fallback = "") {
      try {
        if (typeof document === "undefined") return fallback;
        const probe = document.createElement("div");
        probe.style.position = "absolute";
        probe.style.left = "-9999px";
        probe.style.width = "0";
        probe.style.height = "0";
        probe.style.backgroundColor = `var(${varName})`;
        document.body.appendChild(probe);
        const resolved = getComputedStyle(probe).backgroundColor;
        document.body.removeChild(probe);
        if (resolved && resolved !== "rgba(0, 0, 0, 0)" && resolved !== "transparent") return resolved;
      } catch (e) {
        // fallthrough to raw variable read
      }
      try {
        const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
        if (raw) return raw;
      } catch (e) {
        // ignore
      }
      return fallback;
    }

    function toRgba(color: string | undefined | null, alpha: number) {
      if (!color) return color || undefined;
      const m = String(color).match(/rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/);
      if (m) {
        return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})`;
      }
      // Cannot parse — return raw color so xterm can try to use it.
      return color;
    }

    // Build and apply an xterm theme by sampling app CSS variables. This
    // is intentionally defensive: failures must never break the terminal
    // connection logic.
    const applyComputedTheme = (t: Terminal) => {
      try {
        const container = containerRef.current;
        if (!container) return;
        const computed = getComputedStyle(container);

        // Prefer computed values from the container, but fall back to
        // resolving CSS variables and safe defaults. Also treat fully
        // transparent as "no value" and fall back.
        const isTransparent = (v?: string) => {
          if (!v) return true;
          const s = v.trim();
          return s === "transparent" || s === "rgba(0, 0, 0, 0)" || s === "rgba(0,0,0,0)";
        };

        let background = computed.backgroundColor;
        if (isTransparent(background)) {
          background = resolveVar("--color-card", "") || resolveVar("--color-background", "") || "#000";
        }

        let foreground = computed.color;
        if (isTransparent(foreground)) {
          foreground = resolveVar("--color-card-foreground", "") || resolveVar("--color-foreground", "#fff");
        }

        const primary = resolveVar("--color-primary", resolveVar("--primary", foreground));
        const destructive = resolveVar("--destructive", "#ff5f6d");
        const chart2 = resolveVar("--chart-2", "#66d9ef");
        const chart3 = resolveVar("--chart-3", "#c792ea");
        const chart4 = resolveVar("--chart-4", "#8bd46f");
        const chart5 = resolveVar("--chart-5", "#ffd166");

        const theme: Record<string, string | undefined> = {
          background,
          foreground,
          cursor: primary,
          selection: toRgba(primary, 0.12) || undefined,
          black: resolveVar("--color-background", "#000"),
          red: destructive,
          green: chart4,
          yellow: chart5,
          blue: primary,
          magenta: chart3,
          cyan: chart2,
          white: foreground,
          brightBlack: resolveVar("--color-muted", "#6b7280"),
          brightRed: destructive,
          brightGreen: chart4,
          brightYellow: chart5,
          brightBlue: resolveVar("--sidebar-primary", primary),
          brightMagenta: chart3,
          brightCyan: chart2,
          brightWhite: resolveVar("--color-foreground", foreground),
        };

        // Try the typical runtime APIs in a safe order.
        try {
          const anyT = t as any;
          if (typeof anyT.setOption === "function") {
            anyT.setOption("theme", theme);
          } else if (typeof anyT.setOptions === "function") {
            anyT.setOptions({ theme });
          } else if (anyT.options) {
            anyT.options = { ...(anyT.options || {}), theme };
          }
        } catch (e) {
          // ignore theme application errors
        }

        // DOM fallbacks: ensure xterm elements get inline styles so they
        // don't remain black even if the renderer doesn't pick up theme.
        try {
          const root = container.querySelector(".xterm") as HTMLElement | null;
          if (root) {
            root.style.backgroundColor = background;
            root.style.color = foreground;
            const viewport = root.querySelector(".xterm-viewport") as HTMLElement | null;
            if (viewport) viewport.style.backgroundColor = background;
            const screen = root.querySelector(".xterm-screen, .xterm-rows") as HTMLElement | null;
            if (screen) screen.style.color = foreground;
            // canvases may be used by some renderers; give them a matching
            // CSS background so the page doesn't show solid black behind
            // transparent areas if the canvas isn't fully repainted yet.
            root.querySelectorAll("canvas").forEach((c) => {
              try {
                (c as HTMLCanvasElement).style.backgroundColor = background;
              } catch (e) {
                // ignore
              }
            });
          }
          // Keep the container element visually consistent as well.
          container.style.backgroundColor = background;
        } catch (e) {
          // ignore DOM fallback errors
        }
      } catch (e) {
        // swallow any error — theme should be a best-effort enhancement
      }
    };

    // Defer opening and fitting until after layout so xterm's internal
    // render service is fully initialized. Calling fit immediately can
    // sometimes trigger async code paths that see partially-initialized
    // internals (causing "dimensions of undefined"). Using
    // requestAnimationFrame ensures the container is attached and measured.
    const raf = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      try {
        term.open(container);
      } catch (e) {
        // opening may throw on some edge cases; bail out gracefully
        return;
      }
      try {
        // fit in next tick as well to avoid racing with xterm internal timers
        setTimeout(() => {
          try {
            fit.fit();
            // After the terminal DOM has been attached we can compute the
            // application's CSS variables to build a matching xterm theme.
            // Use the container element so the computed values respect
            // any theme class (e.g. `.dark`) applied to the document.
            try {
              applyComputedTheme(term);
            } catch (e) {
              // theme application must never break the terminal logic
            }
          } catch (e) {
            // ignore
          }
        }, 0);
      } catch (e) {
        // ignore
      }
    });

    const handleResize = () => {
      try {
        fit.fit();
        // best-effort: use public cols/rows
        const cols = term.cols ?? null;
        const rows = term.rows ?? null;
        const activeSessionId = sessionIdRef.current;
        if (activeSessionId && cols && rows) {
          invoke("resize_terminal", {
            args: { sessionId: activeSessionId, cols, rows },
          }).catch(() => {});
        }
      } catch (e) {
        // ignore
      }
    };

    window.addEventListener("resize", handleResize);

    // Observe theme changes on the document so the terminal updates when
    // the user toggles light/dark modes. Do not touch connection logic —
    // just update visual options on the existing terminal instance.
    const themeObserver = new MutationObserver(() => {
      try {
        if (termRef.current) applyComputedTheme(termRef.current);
      } catch (e) {
        // ignore theme update errors
      }
    });
    try {
      // watch both html and body class attribute changes (common places
      // where apps toggle a `.dark` class)
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });
      if (document.body) {
        themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
      }
    } catch (e) {
      // ignore if observation not permitted in some environments
    }

   return () => {
      window.removeEventListener("resize", handleResize);
      try {
        // cancel RAF if still pending
        cancelAnimationFrame(raf);
      } catch (e) {
        // ignore
      }
      try {
        themeObserver.disconnect();
      } catch (e) {
        // ignore
      }
      try {
        term.dispose();
      } catch (e) {
        // ignore
      }
      try {
        dataDisposable.dispose();
      } catch (e) {
        // ignore
      }
      try {
        titleDisposable.dispose();
      } catch (e) {
        // ignore
      }
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
      try {
        unlistenRef.current();
      } catch (_) {
        // ignore
      }
      unlistenRef.current = null;
    }
    sessionIdRef.current = null;
    lastSeqRef.current = 0;
    try {
      await invoke("detach_terminal_session", { args: { sessionId: current } });
    } catch (_) {
      // ignore
    }
  }, []);

  const attachToSession = useCallback(
    async (sessionId: string) => {
      const term = termRef.current;
      if (!term) return;

      if (sessionIdRef.current === sessionId) {
        setActiveSessionId(sessionId);
        setIsMenuOpen(false);
        try {
          term.focus();
        } catch (_) {
          // ignore
        }
        return;
      }

      const token = attachTokenRef.current + 1;
      attachTokenRef.current = token;

      await detachCurrentSession();

      const handler = (event: any) => {
        if (attachTokenRef.current !== token) return;
        try {
          const payload = (event as any).payload ?? null;
          if (!payload) return;
          const seq = typeof payload.seq === "number" ? payload.seq : NaN;
          const data = typeof payload.data === "string" ? payload.data : String(payload);
          if (!Number.isNaN(seq) && seq > lastSeqRef.current) {
            try {
              term.write(data);
            } catch (_) {
              // ignore write errors
            }
            lastSeqRef.current = seq;
          }
        } catch (_) {
          // ignore
        }
      };

      let unlisten: UnlistenFn | null = null;
      try {
        unlisten = await listen(`terminal-output-${sessionId}`, handler);
      } catch (error) {
        term.writeln("无法监听终端输出：" + String(error));
        return;
      }

      if (attachTokenRef.current !== token) {
        if (unlisten) {
          try {
            unlisten();
          } catch (_) {
            // ignore
          }
        }
        return;
      }

      sessionIdRef.current = sessionId;
      unlistenRef.current = unlisten;
      lastSeqRef.current = 0;

      try {
        const snapshot = await invoke<TerminalChunk[]>("attach_terminal_session", {
          args: { sessionId },
        });
        if (attachTokenRef.current === token && sessionIdRef.current === sessionId) {
          try {
            term.reset();
          } catch (_) {
            // ignore
          }
          for (const item of snapshot) {
            if (typeof item.seq === "number" && item.seq > lastSeqRef.current) {
              try {
                term.write(item.data);
              } catch (_) {
                // ignore
              }
              lastSeqRef.current = item.seq;
            }
          }
        }
      } catch (error) {
        if (attachTokenRef.current === token && sessionIdRef.current === sessionId) {
          term.writeln("无法附加到终端会话：" + String(error));
        }
      }

      if (attachTokenRef.current !== token || sessionIdRef.current !== sessionId) {
        return;
      }

      setActiveSessionId(sessionId);
      setIsMenuOpen(false);

      try {
        term.focus();
      } catch (_) {
        // ignore
      }

      try {
        fitRef.current?.fit();
        const cols = term.cols;
        const rows = term.rows;
        if (cols && rows) {
          await invoke("resize_terminal", {
            args: {
              sessionId,
              cols,
              rows,
            },
          });
        }
      } catch (_) {
        // ignore
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
  }, [projectPath, attachToSession, createSession, detachCurrentSession, refreshSessions]);

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
              className={cn("ml-2 h-4 w-4 transition-transform", isMenuOpen && "rotate-180")}
              aria-hidden
            />
          </button>
          {isMenuOpen && (
            <div className="absolute left-0 top-full z-20 mt-2 w-64 rounded-md border bg-card shadow-lg">
              <div className="max-h-64 overflow-y-auto py-1" role="menu">
                {sessionIds.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">暂无终端会话</div>
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
    </div>
  );
}
