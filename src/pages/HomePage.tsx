import { Button } from "@/components/ui/button";
import { useDownloadStatus } from "@/components/ProotDownloadProgress";

type HomePageProps = {
  onOpenProjectDialog: () => void;
  onOpenCreateDialog: () => void;
  onOpenPlugins: () => void;
};

const secondaryActions = [
  { label: "插件", id: "plugins" },
  { label: "设置", id: "settings" },
  { label: "关于", id: "about" },
];

function HomePage({
  onOpenProjectDialog,
  onOpenCreateDialog,
  onOpenPlugins,
}: HomePageProps) {
  const { isDownloading, isReady } = useDownloadStatus();
  const isDisabled = isDownloading || !isReady;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12 pb-safe">
      <div className="flex w-full max-w-sm flex-col items-stretch gap-6">
        <header className="text-center">
          <p className="text-sm font-medium text-muted-foreground">欢迎回来</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            TruidIDE
          </h1>
        </header>
        <nav className="flex flex-col gap-3">
          <Button
            className="w-full py-6 text-base"
            onClick={onOpenProjectDialog}
            disabled={isDisabled}
          >
            打开
          </Button>
          <Button
            className="w-full py-6 text-base"
            onClick={onOpenCreateDialog}
            disabled={isDisabled}
          >
            创建
          </Button>
          {secondaryActions.map((action) => (
            <Button
              key={action.id}
              className="w-full py-6 text-base"
              onClick={action.id === "plugins" ? onOpenPlugins : undefined}
              disabled={isDisabled}
            >
              {action.label}
            </Button>
          ))}
        </nav>
      </div>
    </main>
  );
}

export default HomePage;
