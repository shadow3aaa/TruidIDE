import { EditorView } from "@codemirror/view";

// Theme extension to apply Maple Mono font to CodeMirror editor
// 注意：fontSize 已移除，由动态缩放扩展控制
export const mapleFontTheme = EditorView.baseTheme({
  ".cm-content": {
    fontFamily:
      '"MapleMonoNF", ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", "Courier New", monospace',
    lineHeight: "1.5",
  },
  ".cm-editor": {
    fontFamily:
      '"MapleMonoNF", ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", "Courier New", monospace',
  },
});

export default mapleFontTheme;
