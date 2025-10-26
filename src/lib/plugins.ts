import { invoke } from "@tauri-apps/api/core";

import type { PluginSummary, StartLspSessionResult } from "@/types/plugin";

export async function listPlugins(): Promise<PluginSummary[]> {
  return invoke<PluginSummary[]>("list_plugins");
}

export async function refreshPlugins(): Promise<PluginSummary[]> {
  return invoke<PluginSummary[]>("refresh_plugins");
}

export async function importPlugin(sourcePath: string): Promise<PluginSummary> {
  return invoke<PluginSummary>("import_plugin", { sourcePath });
}

export async function removePlugin(pluginId: string): Promise<PluginSummary[]> {
  return invoke<PluginSummary[]>("remove_plugin", { pluginId });
}

export async function startLspSession(args: {
  pluginId: string;
  languageId?: string;
  workspacePath: string;
  clientCapabilities?: unknown;
  workspaceFolders?: unknown;
  initializationOptions?: unknown;
}): Promise<StartLspSessionResult> {
  return invoke<StartLspSessionResult>("start_lsp_session", {
    args: {
      pluginId: args.pluginId,
      languageId: args.languageId,
      workspacePath: args.workspacePath,
      clientCapabilities: args.clientCapabilities,
      workspaceFolders: args.workspaceFolders,
      initializationOptions: args.initializationOptions,
    },
  });
}

export async function sendLspPayload(args: {
  sessionId: string;
  payload: unknown;
}): Promise<void> {
  await invoke("send_lsp_payload", {
    payload: {
      sessionId: args.sessionId,
      payload: args.payload,
    },
  });
}

export async function stopLspSession(sessionId: string): Promise<void> {
  await invoke("stop_lsp_session", { args: { sessionId } });
}
