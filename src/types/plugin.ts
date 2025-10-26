export type PluginKindSummary = {
  type: "lsp";
  languageIds: string[];
  initializationOptions?: unknown;
};

export type PluginLocation = "builtIn" | "user";

export type PluginSummary = {
  id: string;
  name: string;
  version: string;
  description?: string | null;
  author?: string | null;
  enabled: boolean;
  tags: string[];
  location: PluginLocation;
  kind: PluginKindSummary;
};

export type PathMapping = {
  /** Host workspace path (e.g., /data/user/0/.../files/projects/myapp) */
  hostWorkspace: string;
  /** Guest workspace path inside proot (e.g., /mnt/workspace) */
  guestWorkspace: string;
  /** Host plugin path */
  hostPlugin: string;
  /** Guest plugin path inside proot (e.g., /opt/truidide/plugins/plugin-id) */
  guestPlugin: string;
};

export type StartLspSessionResult = {
  sessionId: string;
  pluginId: string;
  languageId: string;
  initializationOptions?: unknown;
  clientCapabilities?: unknown;
  workspaceFolders?: unknown;
  pathMapping?: PathMapping | null;
};
