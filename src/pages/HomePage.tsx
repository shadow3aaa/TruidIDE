import { Button } from "@/components/ui/button";
import { useDownloadStatus } from "@/components/ProotDownloadProgress";
import Lottie from "lottie-react";
import catAnimation from "@/assets/cat.json";

type HomePageProps = {
  onOpenFolder: () => void;
  onOpenTerminal: () => void;
  onOpenPlugins: () => void;
};

const secondaryActions = [
  { label: "插件", id: "plugins" },
  { label: "设置", id: "settings" },
  { label: "关于", id: "about" },
];

function HomePage({
  onOpenFolder,
  onOpenTerminal,
  onOpenPlugins,
}: HomePageProps) {
  const { isDownloading, isReady } = useDownloadStatus();
  const isDisabled = isDownloading || !isReady;

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center px-6 py-12"
      style={{
        paddingTop: "max(0rem, var(--safe-area-inset-top, 0))",
        paddingBottom: "max(3rem, var(--safe-area-inset-bottom, 0))",
      }}
    >
      <div className="flex w-full max-w-sm flex-col items-stretch gap-6">
        <header className="flex flex-col items-center justify-center text-center">
          <Lottie
            animationData={catAnimation}
            className="h-40 w-40 max-w-full"
            autoplay
            loop
          />
          <h1 className="text-3xl font-semibold tracking-tight">TruidIDE</h1>
        </header>
        <nav className="flex flex-col gap-3">
          <Button
            className="w-full py-6 text-base"
            onClick={onOpenFolder}
            disabled={isDisabled}
          >
            打开
          </Button>
          <Button
            className="w-full py-6 text-base"
            onClick={onOpenTerminal}
            disabled={isDisabled}
          >
            终端
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
