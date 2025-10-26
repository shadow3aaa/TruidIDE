/**
 * LSP Path Mapper
 *
 * 处理 LSP 协议中的路径转换，特别是在 Android 的 PRoot 环境中。
 * 在 Android 上，文件路径需要在 host 路径和 guest (proot) 路径之间转换。
 */

export interface PathMapping {
  /** Host workspace path (e.g., /data/user/0/.../files/projects/myapp) */
  hostWorkspace: string;
  /** Guest workspace path inside proot (e.g., /mnt/workspace) */
  guestWorkspace: string;
  /** Host plugin path */
  hostPlugin: string;
  /** Guest plugin path inside proot (e.g., /opt/truidide/plugins/plugin-id) */
  guestPlugin: string;
}

export class LspPathMapper {
  private pathMapping: PathMapping | null = null;

  constructor(pathMapping?: PathMapping | null) {
    this.pathMapping = pathMapping || null;
  }

  /**
   * 更新路径映射配置
   */
  setPathMapping(pathMapping: PathMapping | null): void {
    this.pathMapping = pathMapping;
  }

  /**
   * 检查是否需要路径转换 (只有 Android + PRoot 环境需要)
   */
  needsConversion(): boolean {
    return this.pathMapping !== null;
  }

  /**
   * 标准化路径分隔符为正斜杠
   */
  private normalizePath(path: string): string {
    return path.replace(/\\/g, "/");
  }

  /**
   * 将 host 文件路径转换为 file:// URI (guest 路径)
   *
   * @param hostPath - Host 文件系统路径
   * @returns file:// URI (如果需要转换，则为 guest 路径)
   */
  hostPathToFileUri(hostPath: string): string {
    const normalized = this.normalizePath(hostPath);

    if (!this.pathMapping) {
      // 桌面平台：直接转换为 file:// URI
      if (/^[a-zA-Z]:\//.test(normalized)) {
        // Windows: C:/path -> file:///C:/path
        return encodeURI(`file:///${normalized}`);
      }
      if (normalized.startsWith("/")) {
        // Unix: /path -> file:///path
        return encodeURI(`file://${normalized}`);
      }
      return encodeURI(`file://${normalized}`);
    }

    // Android PRoot: 需要将 host 路径映射到 guest 路径
    const normalizedHost = this.normalizePath(this.pathMapping.hostWorkspace);
    const normalizedGuest = this.normalizePath(this.pathMapping.guestWorkspace);

    if (normalized.startsWith(normalizedHost)) {
      // 在工作区内的文件
      const relativePath = normalized.slice(normalizedHost.length);
      const guestPath = normalizedGuest + relativePath;
      return encodeURI(`file://${guestPath}`);
    }

    // 不在工作区内，可能是插件文件或其他位置
    const normalizedPluginHost = this.normalizePath(
      this.pathMapping.hostPlugin,
    );
    const normalizedPluginGuest = this.normalizePath(
      this.pathMapping.guestPlugin,
    );

    if (normalized.startsWith(normalizedPluginHost)) {
      const relativePath = normalized.slice(normalizedPluginHost.length);
      const guestPath = normalizedPluginGuest + relativePath;
      return encodeURI(`file://${guestPath}`);
    }

    // 未知路径，保持原样（可能会导致 LSP 无法访问）
    console.warn(
      `[LSP Path Mapper] 无法转换路径到 guest: ${hostPath}，该路径不在已知的映射范围内`,
    );
    return encodeURI(`file://${normalized}`);
  }

  /**
   * 将 file:// URI (guest 路径) 转换回 host 文件路径
   *
   * @param fileUri - file:// URI (可能是 guest 路径)
   * @returns Host 文件系统路径
   */
  fileUriToHostPath(fileUri: string): string {
    let decoded: string;
    try {
      decoded = decodeURI(fileUri);
    } catch {
      decoded = fileUri;
    }

    // 移除 file:// 前缀
    let path = decoded.replace(/^file:\/\//, "");

    // 处理 Windows 格式: file:///C:/... -> C:/...
    if (/^\/[a-zA-Z]:\//.test(path)) {
      path = path.slice(1);
    }

    if (!this.pathMapping) {
      // 桌面平台：直接返回
      return path;
    }

    // Android PRoot: 需要将 guest 路径映射回 host 路径
    const normalized = this.normalizePath(path);
    const normalizedGuest = this.normalizePath(this.pathMapping.guestWorkspace);
    const normalizedHost = this.normalizePath(this.pathMapping.hostWorkspace);

    if (normalized.startsWith(normalizedGuest)) {
      // 工作区文件
      const relativePath = normalized.slice(normalizedGuest.length);
      return normalizedHost + relativePath;
    }

    const normalizedPluginGuest = this.normalizePath(
      this.pathMapping.guestPlugin,
    );
    const normalizedPluginHost = this.normalizePath(
      this.pathMapping.hostPlugin,
    );

    if (normalized.startsWith(normalizedPluginGuest)) {
      // 插件文件
      const relativePath = normalized.slice(normalizedPluginGuest.length);
      return normalizedPluginHost + relativePath;
    }

    // 未知路径，保持原样
    console.warn(
      `[LSP Path Mapper] 无法转换路径到 host: ${fileUri}，该路径不在已知的映射范围内`,
    );
    return path;
  }

  /**
   * 转换 LSP 消息中的所有路径
   *
   * @param message - LSP JSON-RPC 消息
   * @param direction - 转换方向: 'toGuest' (发送给 LSP) 或 'toHost' (从 LSP 接收)
   * @returns 转换后的消息
   */
  transformLspMessage(message: any, direction: "toGuest" | "toHost"): any {
    if (!this.pathMapping) {
      // 桌面平台不需要转换
      return message;
    }

    // 深拷贝以避免修改原始对象
    const transformed = JSON.parse(JSON.stringify(message));

    const transform = (obj: any): void => {
      if (obj === null || typeof obj !== "object") {
        return;
      }

      // 递归处理数组
      if (Array.isArray(obj)) {
        obj.forEach(transform);
        return;
      }

      // 处理对象的每个属性
      for (const key of Object.keys(obj)) {
        const value = obj[key];

        // 检查是否是 URI 字段
        if (
          (key === "uri" || key === "rootUri" || key.endsWith("Uri")) &&
          typeof value === "string" &&
          value.startsWith("file://")
        ) {
          if (direction === "toHost") {
            obj[key] = `file://${this.fileUriToHostPath(value)}`;
          }
          // toGuest 方向已经在发送前转换
        }

        // 递归处理嵌套对象
        if (value !== null && typeof value === "object") {
          transform(value);
        }
      }
    };

    transform(transformed);
    return transformed;
  }
}
