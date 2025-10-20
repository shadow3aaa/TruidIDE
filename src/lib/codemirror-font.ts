import { EditorView } from "@codemirror/view";

// Theme extension to apply Maple Mono font to CodeMirror editor
export const mapleFontTheme = EditorView.baseTheme({
  ".cm-content": {
    fontFamily: '"MapleMonoNF", ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", "Courier New", monospace',
    fontSize: "13px",
    lineHeight: "1.5",
  },
  ".cm-editor": {
    fontFamily: '"MapleMonoNF", ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", "Courier New", monospace',
  },
});

export default mapleFontTheme;
