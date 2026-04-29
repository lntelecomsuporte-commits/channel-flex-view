import { useAppUpdate } from "@/hooks/useAppUpdate";
import { Download, X } from "lucide-react";

export function UpdateNotification() {
  const { available, currentVersionCode, dismiss, download } = useAppUpdate();

  if (!available) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-title"
    >
      <div className="bg-background border border-border rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
              <Download className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 id="update-title" className="text-lg font-bold text-foreground">
                Nova versão disponível
              </h2>
              <p className="text-xs text-muted-foreground">
                {currentVersionCode !== null && (
                  <>versão atual: {currentVersionCode} → </>
                )}
                nova: {available.versionName} ({available.versionCode})
              </p>
            </div>
          </div>
          <button
            onClick={dismiss}
            className="text-muted-foreground hover:text-foreground p-1"
            aria-label="Dispensar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {available.notes && (
          <p className="text-sm text-foreground/80 leading-relaxed border-l-2 border-primary/40 pl-3">
            {available.notes}
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Ao clicar em <strong>Atualizar agora</strong> o download começa. Quando terminar,
          confirme a instalação — seus dados e login serão mantidos.
        </p>

        <div className="flex gap-2 justify-end">
          <button
            onClick={dismiss}
            className="px-4 py-2 text-sm rounded-md border border-border hover:bg-muted/30 transition-colors"
          >
            Mais tarde
          </button>
          <button
            onClick={download}
            className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Atualizar agora
          </button>
        </div>
      </div>
    </div>
  );
}
