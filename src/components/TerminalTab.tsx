import { useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

type Props = {
  projectPath: string;
};

export default function TerminalTab({ projectPath }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

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
        if (sessionId && cols && rows) {
          invoke("resize_terminal", { session_id: sessionId, cols, rows }).catch(() => {});
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
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

  let unlisten: UnlistenFn | null = null;

    const start = async () => {
      try {
        const sid: string = await invoke("start_terminal_session", { cwd: projectPath });
        setSessionId(sid);
        setRunning(true);
        unlisten = await listen(`terminal-output-${sid}`, (event) => {
          try {
            const payload = (event as any).payload ?? "";
            term.write(String(payload));
          } catch (e) {
            // ignore
          }
        });

        term.onData((data) => {
          if (!sid) return;
          invoke("send_terminal_input", { sessionId: sid, input: data }).catch(() => {});
        });

        // initial resize
          try {
            const fit = fitRef.current;
            fit?.fit();
            try { term.focus(); } catch (e) { /* ignore */ }
            const cols = term.cols;
            const rows = term.rows;
            await invoke("resize_terminal", { sessionId: sid, cols, rows });
          } catch (_) {
            // ignore
          }
      } catch (e) {
        term.writeln("无法启动终端会话：" + String(e));
      }
    };

    start();

    return () => {
      if (unlisten) {
        try {
          unlisten();
        } catch (e) {
          // ignore
        }
      }
      if (sessionId) {
        invoke("stop_terminal_session", { sessionId: sessionId }).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-2 py-2 border-b">
        <div className="text-sm font-medium">终端（项目环境）</div>
        <div className="ml-auto text-xs text-muted-foreground">{running ? "已连接" : "未连接"}</div>
      </div>
  <div ref={containerRef} className="flex-1 overflow-hidden bg-card" />
    </div>
  );
}
