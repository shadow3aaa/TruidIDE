import CodeMirror from "@uiw/react-codemirror";
import mapleFontTheme from "@/lib/codemirror-font";
import { Button } from "@/components/ui/button";

type Props = {
  activeFilePath: string | null;
  fileContent: string;
  isLoadingFileContent: boolean;
  fileContentError: string | null;
  editorExtensions: any[];
  onEditorChange: (value: string) => void;
  refreshFileContent: () => void;
  editorRef?: React.MutableRefObject<any | null>;
};

export function EditorPane({
  activeFilePath,
  fileContent,
  isLoadingFileContent,
  fileContentError,
  editorExtensions,
  onEditorChange,
  refreshFileContent,
  editorRef,
}: Props) {
  return (
    // 这个外层 div 仍然是一个 flex item，用于在 ProjectWorkspace 中占据空间。
    <div className="flex flex-1 flex-col min-h-0">
      {/*
        [策略变更]: 使用 CSS Grid 替代 Flexbox 进行内部布局。
        - `grid`: 启用网格布局。
        - `grid-rows-[auto_1fr]`: 定义两行。
            - `auto`: 第一行（头部）的高度由其内容决定。
            - `1fr`: 第二行（编辑器容器）将占据所有剩余的垂直空间。
        这种方式对于此类布局通常比嵌套 flexbox 更可靠。
      */}
      <main className="flex-1 min-h-0 px-0 py-0 sm:px-0 sm:py-0">
        {/* 编辑器容器：直接位于顶栏下方，占据所有剩余空间 */}
        <div className="w-full relative min-h-0 h-full">
          {isLoadingFileContent ? (
            <div className="absolute inset-0 flex items-center justify-center px-6 text-sm text-muted-foreground">
              正在加载文件内容…
            </div>
          ) : fileContentError ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm text-destructive">{fileContentError}</p>
              <Button size="sm" variant="outline" onClick={refreshFileContent}>
                重试
              </Button>
            </div>
          ) : activeFilePath ? (
            <div className="absolute inset-0 no-scrollbar">
              <CodeMirror
                value={fileContent}
                extensions={[mapleFontTheme, ...editorExtensions]}
                onChange={onEditorChange}
                onCreateEditor={(editor) => {
                  try {
                    if (editorRef) {
                      // @uiw/react-codemirror 的 onCreateEditor 通常会传入 EditorView
                      editorRef.current = editor as any;
                    }
                  } catch (e) {
                    // ignore
                  }
                }}
                height="100%"
                // 增加一个行内 style，确保 CodeMirror 内部的容器也能正确应用高度。
                style={{ height: "100%" }}
                basicSetup={{
                  highlightActiveLine: true,
                  bracketMatching: true,
                }}
              />
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center px-6 text-sm text-muted-foreground">
              选择一个文件以在此处查看或编辑内容。
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default EditorPane;
