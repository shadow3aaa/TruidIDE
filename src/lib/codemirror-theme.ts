import { EditorView } from "@codemirror/view";

/**
 * TruidIDE CodeMirror 主题
 * 包含编辑器和 LSP 补全的样式
 */
export const truidideTheme = EditorView.theme(
  {
    // ===== 编辑器基础样式 =====
    "&": {
      backgroundColor: "var(--color-card)",
      color: "var(--color-card-foreground)",
    },
    ".cm-content": {
      caretColor: "var(--color-primary)",
      fontFamily: '"MapleMonoNF", ui-monospace, monospace',
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--color-primary)",
    },
    "&.cm-focused .cm-selectionBackground, ::selection": {
      backgroundColor: "var(--color-accent)",
    },
    ".cm-activeLine": {
      backgroundColor: "var(--color-muted)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--color-card)",
      color: "var(--color-muted-foreground)",
      border: "none",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "var(--color-muted)",
    },

    // ===== 通用 Tooltip 样式 =====
    ".cm-tooltip": {
      backgroundColor: "var(--color-popover)",
      border: "1px solid var(--color-border)",
      borderRadius: "var(--radius-md)",
      boxShadow:
        "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
      color: "var(--color-popover-foreground)",
      fontFamily: '"MapleMonoNF", ui-monospace, monospace',
    },

    // ===== LSP 补全列表样式 =====
    ".cm-tooltip.cm-tooltip-autocomplete": {
      backgroundColor: "var(--color-popover)",
      border: "1px solid var(--color-border)",
      borderRadius: "var(--radius-md)",
      boxShadow:
        "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
      padding: "4px",
      minWidth: "300px",
      maxHeight: "400px",
      fontFamily: '"MapleMonoNF", ui-monospace, monospace',
      fontSize: "13px",
    },

    // 补全列表
    ".cm-tooltip-autocomplete ul": {
      margin: 0,
      padding: 0,
      listStyle: "none",
    },

    // 补全项
    ".cm-tooltip-autocomplete ul li": {
      padding: "6px 10px",
      margin: "2px 0",
      cursor: "pointer",
      borderRadius: "var(--radius-sm)",
      display: "flex",
      alignItems: "center",
      gap: "8px",
      transition: "background-color 0.15s ease",
    },

    // 补全项悬停
    ".cm-tooltip-autocomplete ul li:hover": {
      backgroundColor: "var(--color-accent)",
    },

    // 选中的补全项
    ".cm-tooltip-autocomplete ul li[aria-selected]": {
      backgroundColor: "var(--color-primary)",
      color: "var(--color-primary-foreground)",
    },

    // 补全项标签容器（包含图标和文本）
    ".cm-completionLabel": {
      flex: 1,
      display: "flex",
      alignItems: "center",
      gap: "8px",
      fontWeight: 500,
    },

    // 补全项标签文本
    ".cm-completionLabelText": {
      flex: 1,
    },

    // 补全项详情（右侧次要文本）
    ".cm-completionDetail": {
      fontSize: "11px",
      color: "var(--color-muted-foreground)",
      fontStyle: "normal",
    },

    // 选中时的详情颜色
    ".cm-tooltip-autocomplete ul li[aria-selected] .cm-completionDetail": {
      color: "var(--color-primary-foreground)",
      opacity: 0.8,
    },

    // 补全项类型图标
    ".cm-completionIcon": {
      width: "16px",
      height: "16px",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "10px",
      fontWeight: 600,
      borderRadius: "3px",
      flexShrink: 0,
    },

    // 不同类型的图标颜色
    ".cm-completionIcon-function, .cm-completionIcon-method": {
      backgroundColor: "oklch(0.646 0.222 41.116 / 0.15)",
      color: "oklch(0.646 0.222 41.116)",
    },
    ".cm-completionIcon-class, .cm-completionIcon-interface": {
      backgroundColor: "oklch(0.6 0.118 184.704 / 0.15)",
      color: "oklch(0.6 0.118 184.704)",
    },
    ".cm-completionIcon-variable, .cm-completionIcon-property": {
      backgroundColor: "oklch(0.398 0.07 227.392 / 0.15)",
      color: "oklch(0.398 0.07 227.392)",
    },
    ".cm-completionIcon-keyword": {
      backgroundColor: "oklch(0.828 0.189 84.429 / 0.15)",
      color: "oklch(0.828 0.189 84.429)",
    },
    ".cm-completionIcon-text, .cm-completionIcon-constant": {
      backgroundColor: "oklch(0.769 0.188 70.08 / 0.15)",
      color: "oklch(0.769 0.188 70.08)",
    },

    // ===== LSP 文档提示框样式 =====
    ".cm-tooltip.cm-completionInfo": {
      backgroundColor: "var(--color-popover)",
      border: "1px solid var(--color-border)",
      borderRadius: "var(--radius-md)",
      boxShadow:
        "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
      padding: "12px",
      maxWidth: "400px",
      maxHeight: "300px",
      overflow: "auto",
    },

    ".cm-completionInfo.cm-completionInfo-left": {
      marginRight: "8px",
    },

    ".cm-completionInfo.cm-completionInfo-right": {
      marginLeft: "8px",
    },

    // LSP Hover Tooltip 样式（不同于补全文档）
    ".cm-tooltip.cm-lsp-hover-tooltip": {
      backgroundColor: "var(--color-popover)",
      border: "1px solid var(--color-border)",
      borderRadius: "var(--radius-md)",
      boxShadow:
        "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
      padding: "12px",
      maxWidth: "500px",
      maxHeight: "400px",
      overflow: "auto",
      fontFamily: '"MapleMonoNF", ui-monospace, monospace',
      fontSize: "13px",
      lineHeight: 1.6,
      color: "var(--color-popover-foreground)",
    },

    // 通用 LSP 文档内容样式
    ".cm-lsp-documentation": {
      fontFamily: '"MapleMonoNF", ui-monospace, monospace',
      fontSize: "13px",
      lineHeight: 1.6,
      color: "var(--color-popover-foreground)",
    },

    ".cm-lsp-documentation p": {
      margin: "0 0 8px 0",
    },

    ".cm-lsp-documentation p:last-child": {
      marginBottom: 0,
    },

    ".cm-lsp-documentation pre": {
      backgroundColor: "var(--color-muted)",
      padding: "8px",
      borderRadius: "var(--radius-sm)",
      margin: "8px 0",
      overflow: "auto",
      fontFamily: '"MapleMonoNF", ui-monospace, monospace',
      fontSize: "12px",
    },

    ".cm-lsp-documentation code": {
      backgroundColor: "var(--color-muted)",
      padding: "2px 4px",
      borderRadius: "3px",
      fontFamily: '"MapleMonoNF", ui-monospace, monospace',
      fontSize: "12px",
    },

    ".cm-lsp-documentation pre code": {
      backgroundColor: "transparent",
      padding: 0,
    },

    // ===== 匹配文本高亮 =====
    ".cm-completionMatchedText": {
      textDecoration: "none",
      fontWeight: 700,
      color: "var(--color-primary)",
    },

    ".cm-tooltip-autocomplete ul li[aria-selected] .cm-completionMatchedText": {
      color: "var(--color-primary-foreground)",
      textDecoration: "underline",
    },
  },
  { dark: false },
);

/**
 * 暗色主题
 */
export const truidideThemeDark = EditorView.theme(
  {
    // 暗色主题使用相同的 CSS 变量，所以不需要重复定义大部分样式
    // 只需要调整一些特定的暗色优化
    ".cm-tooltip.cm-tooltip-autocomplete": {
      boxShadow:
        "0 10px 15px -3px rgb(0 0 0 / 0.3), 0 4px 6px -4px rgb(0 0 0 / 0.3)",
    },

    ".cm-tooltip.cm-completionInfo": {
      boxShadow:
        "0 10px 15px -3px rgb(0 0 0 / 0.3), 0 4px 6px -4px rgb(0 0 0 / 0.3)",
    },
  },
  { dark: true },
);
