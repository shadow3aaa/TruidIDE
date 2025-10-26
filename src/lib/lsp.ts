import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import {
  LSPClient,
  languageServerExtensions,
  type LSPClientExtension,
  type Transport,
} from "@codemirror/lsp-client";

import { sendLspPayload, stopLspSession } from "@/lib/plugins";
import { LspPathMapper, type PathMapping } from "@/lib/lsp-path-mapper";

type MessageHandler = (value: string) => void;

type TauriTransportOptions = {
  initializationOptions?: unknown;
  workspaceFolders?: unknown;
  pathMapper?: LspPathMapper;
};

const ENABLE_LSP_DEBUG_LOGS =
  typeof import.meta !== "undefined" &&
  Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);

function describePayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "payload";
  }
  const candidate = payload as { id?: unknown; method?: unknown };
  if (typeof candidate.method === "string" && candidate.id !== undefined) {
    return `request:${candidate.method}`;
  }
  if (typeof candidate.method === "string") {
    return `notification:${candidate.method}`;
  }
  if (candidate.id !== undefined) {
    return `response:${String(candidate.id)}`;
  }
  return "payload";
}

function logLspDebug(sessionId: string, message: string, extra?: unknown) {
  if (!ENABLE_LSP_DEBUG_LOGS) {
    return;
  }
  if (extra !== undefined) {
    console.debug(`[LSP][session:${sessionId}] ${message}`, extra);
  } else {
    console.debug(`[LSP][session:${sessionId}] ${message}`);
  }
}

class TauriTransport implements Transport {
  private readonly sessionId: string;
  private readonly initializationOptions?: unknown;
  private readonly workspaceFolders?: unknown;
  private readonly pathMapper: LspPathMapper;
  private handlers = new Set<MessageHandler>();
  private unlisten: UnlistenFn | null = null;
  private disposed = false;

  constructor(sessionId: string, options?: TauriTransportOptions) {
    this.sessionId = sessionId;
    this.initializationOptions = options?.initializationOptions;
    this.workspaceFolders = options?.workspaceFolders;
    this.pathMapper = options?.pathMapper || new LspPathMapper();
    logLspDebug(this.sessionId, "transport initialized");
    listen<{ sessionId?: string; body?: unknown }>(
      "truidide://lsp/message",
      (event) => {
        if (event.payload?.sessionId !== this.sessionId) {
          return;
        }
        const body = event.payload.body;

        // 解析并转换路径 (从 LSP 服务器接收的消息)
        let decoded: any;
        try {
          decoded = typeof body === "string" ? JSON.parse(body) : body;
          // 转换 guest 路径为 host 路径
          decoded = this.pathMapper.transformLspMessage(decoded, "toHost");
        } catch (error) {
          logLspDebug(this.sessionId, "<= message (failed to parse)", body);
          return;
        }

        const raw = JSON.stringify(decoded);

        if (ENABLE_LSP_DEBUG_LOGS) {
          logLspDebug(
            this.sessionId,
            `<= ${describePayload(decoded)}`,
            decoded,
          );
        }

        for (const handler of this.handlers) {
          handler(raw);
        }
      },
    )
      .then((unlisten) => {
        if (this.disposed) {
          unlisten();
        } else {
          this.unlisten = unlisten;
        }
        logLspDebug(this.sessionId, "transport listener attached");
      })
      .catch((error) => {
        console.error("监听 LSP 消息失败", error);
      });
  }

  send(message: string): void {
    try {
      const payload = JSON.parse(message);

      // 转换 host 路径为 guest 路径
      const transformed = this.pathMapper.transformLspMessage(
        payload,
        "toGuest",
      );

      if (ENABLE_LSP_DEBUG_LOGS) {
        logLspDebug(
          this.sessionId,
          `=> ${describePayload(transformed)}`,
          transformed,
        );
      }

      if (
        transformed &&
        typeof transformed === "object" &&
        transformed.method === "initialize"
      ) {
        const params =
          typeof transformed.params === "object" && transformed.params !== null
            ? { ...transformed.params }
            : {};
        if (this.initializationOptions !== undefined) {
          params.initializationOptions ??= this.initializationOptions;
        }
        if (this.workspaceFolders !== undefined) {
          params.workspaceFolders ??= this.workspaceFolders;
        }
        transformed.params = params;
      }
      void sendLspPayload({ sessionId: this.sessionId, payload: transformed });
    } catch (error) {
      console.error("发送 LSP 消息失败", error);
    }
  }

  subscribe(handler: MessageHandler): void {
    this.handlers.add(handler);
  }

  unsubscribe(handler: MessageHandler): void {
    this.handlers.delete(handler);
  }

  dispose(): void {
    logLspDebug(this.sessionId, "transport disposed");
    this.disposed = true;
    if (this.unlisten) {
      this.unlisten();
      this.unlisten = null;
    }
  }

  async shutdown(): Promise<void> {
    this.dispose();
    try {
      await stopLspSession(this.sessionId);
      logLspDebug(this.sessionId, "stop_lsp_session invoked");
    } catch (error) {
      console.error("关闭 LSP 会话失败", error);
    }
  }
}

export type LspClientEntry = {
  client: LSPClient;
  transport: TauriTransport;
  sessionId: string;
};

export async function createLspClient(options: {
  sessionId: string;
  rootUri: string;
  clientCapabilities?: Record<string, unknown>;
  initializationOptions?: unknown;
  workspaceFolders?: unknown;
  timeoutMs?: number;
  pathMapping?: PathMapping | null;
}): Promise<LspClientEntry> {
  const baseExtensions = languageServerExtensions();
  const configExtensions: (
    | (typeof baseExtensions)[number]
    | LSPClientExtension
  )[] = [...baseExtensions];

  if (
    options.clientCapabilities &&
    Object.keys(options.clientCapabilities).length > 0
  ) {
    configExtensions.push({
      clientCapabilities: options.clientCapabilities,
    });
  }

  const pathMapper = new LspPathMapper(options.pathMapping || null);
  const transport = new TauriTransport(options.sessionId, {
    initializationOptions: options.initializationOptions,
    workspaceFolders: options.workspaceFolders,
    pathMapper,
  });
  const client = new LSPClient({
    rootUri: options.rootUri,
    extensions: configExtensions,
    timeout: options.timeoutMs ?? 15_000,
  });
  client.connect(transport);
  try {
    logLspDebug(options.sessionId, "等待 initialize 响应");
    await client.initializing;
    logLspDebug(options.sessionId, "initialize 成功");
  } catch (error) {
    client.disconnect();
    await transport.shutdown();
    logLspDebug(options.sessionId, "initialize 失败", error);
    throw error;
  }

  return {
    client,
    transport,
    sessionId: options.sessionId,
  };
}
