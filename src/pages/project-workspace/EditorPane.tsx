import CodeMirror from "@uiw/react-codemirror";
import { Button } from "@/components/ui/button";

type Props = {
  activeFilePath: string | null;
  activeFileDisplayPath: string | null;
  fileContent: string;
  isLoadingFileContent: boolean;
  fileContentError: string | null;
  editorExtensions: any[];
  onEditorChange: (value: string) => void;
  refreshFileContent: () => void;
};

export function EditorPane({
  activeFilePath,
  activeFileDisplayPath,
  fileContent,
  isLoadingFileContent,
  fileContentError,
  editorExtensions,
  onEditorChange,
  refreshFileContent,
}: Props) {
  return (
    <div className="flex h-full overflow-hidden">
      <main className="flex-1 overflow-y-auto px-4 pt-6 pb-28 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-4xl">
          <section className="flex flex-1 flex-col gap-4">
            <div className="flex flex-col gap-2 border-b border-border/60 pb-4">
              {activeFilePath ? (
                <p className="break-all text-xs text-muted-foreground">
                  {activeFileDisplayPath ?? activeFilePath}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  从下方面板进入“文件管理”选择一个文件开始编辑。
                </p>
              )}
            </div>
            <div className="relative flex-1 overflow-hidden">
              {isLoadingFileContent ? (
                <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
                  正在加载文件内容…
                </div>
              ) : fileContentError ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                  <p className="text-sm text-destructive">{fileContentError}</p>
                  <Button size="sm" variant="outline" onClick={refreshFileContent}>
                    重试
                  </Button>
                </div>
              ) : activeFilePath ? (
                <CodeMirror
                  value={fileContent}
                  height="100%"
                  extensions={editorExtensions}
                  onChange={(value) => onEditorChange(value)}
                  basicSetup={{ highlightActiveLine: true, bracketMatching: true }}
                  minHeight="100%"
                />
              ) : (
                <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
                  选择一个文件以在此处查看或编辑内容。
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

export default EditorPane;
