import { useEffect, useRef } from "react";
import { useAppUpdate } from "@/hooks/useAppUpdate";
import { Download, X, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { isSelectKey } from "@/lib/remoteKeys";

export function UpdateNotification() {
  const { available, currentVersionCode, dismiss, download, status, progress, error } = useAppUpdate();
  const updateBtnRef = useRef<HTMLButtonElement>(null);
  const dismissBtnRef = useRef<HTMLButtonElement>(null);

  const isBusy = status === "downloading" || status === "installing";
  const isOpen = !!available;

  // Foca o botão "Atualizar agora" assim que o modal abre
  useEffect(() => {
    document.body.dataset.updatePromptOpen = isOpen ? "true" : "false";
    if (!isOpen) {
      delete document.body.dataset.updatePromptOpen;
      return;
    }
    const t = setTimeout(() => updateBtnRef.current?.focus(), 50);
    return () => {
      clearTimeout(t);
      delete document.body.dataset.updatePromptOpen;
    };
  }, [isOpen]);

  // Captura TODAS as teclas do controle remoto enquanto o modal está aberto,
  // impede que cheguem no player/lista de canais por trás, e implementa
  // navegação esquerda/direita entre os dois botões.
  useEffect(() => {
    if (!isOpen) return;

    const stopRemoteEvent = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e as KeyboardEvent & { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.();
    };

    const handler = (e: KeyboardEvent) => {
      // Bloqueia tudo que não é input — modal é totalmente modal pro remote
      const key = e.key;

      // ESC / Back: dispensa (se não estiver baixando)
      if ((key === "Escape" || key === "GoBack" || e.keyCode === 27 || e.keyCode === 4) && !isBusy) {
        stopRemoteEvent(e);
        dismiss();
        return;
      }

      // Setas: alterna entre os 2 botões
      if (key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown") {
        stopRemoteEvent(e);
        if (isBusy) return;
        const active = document.activeElement;
        if (active === updateBtnRef.current) {
          dismissBtnRef.current?.focus();
        } else {
          updateBtnRef.current?.focus();
        }
        return;
      }

      // Enter/OK: executa o botão focado aqui mesmo e não deixa o player receber keydown/keyup.
      if (isSelectKey(e)) {
        stopRemoteEvent(e);
        if (isBusy) return;
        const active = document.activeElement;
        if (active === dismissBtnRef.current) {
          dismiss();
        } else {
          download();
        }
        return;
      }

      // Qualquer outra tecla (números, canal, etc.): bloqueia
      stopRemoteEvent(e);
    };

    const blockKeyUp = (e: KeyboardEvent) => {
      stopRemoteEvent(e);
    };

    // capture=true pra interceptar ANTES dos handlers do player
    window.addEventListener("keydown", handler, true);
    window.addEventListener("keyup", blockKeyUp, true);
    window.addEventListener("keypress", blockKeyUp, true);
    return () => {
      window.removeEventListener("keydown", handler, true);
      window.removeEventListener("keyup", blockKeyUp, true);
      window.removeEventListener("keypress", blockKeyUp, true);
    };
  }, [isOpen, isBusy, dismiss, download]);

  if (!available) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-title"
      onClick={(e) => e.stopPropagation()}
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
          {!isBusy && (
            <button
              onClick={dismiss}
              className="text-muted-foreground hover:text-foreground p-1"
              aria-label="Dispensar"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {available.notes && status === "idle" && (
          <p className="text-sm text-foreground/80 leading-relaxed border-l-2 border-primary/40 pl-3">
            {available.notes}
          </p>
        )}

        {status === "idle" && (
          <p className="text-xs text-muted-foreground">
            Ao clicar em <strong>Atualizar agora</strong>, o app baixa e instala a nova versão automaticamente.
            Seus dados e login serão mantidos.
          </p>
        )}

        {status === "downloading" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-foreground/80 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                Baixando atualização…
              </span>
              <span className="text-muted-foreground tabular-nums">{progress}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-muted/40 overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {status === "installing" && (
          <div className="flex items-center gap-2 text-sm text-foreground/90">
            <CheckCircle2 className="w-4 h-4 text-primary" />
            Download concluído. Confirme a instalação na tela do Android.
          </div>
        )}

        {status === "error" && (
          <div className="flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>
              Falha no download automático ({error}). Abrimos no navegador como alternativa.
            </span>
          </div>
        )}

        {!isBusy && (
          <div className="flex gap-2 justify-end">
            <button
              ref={dismissBtnRef}
              onClick={dismiss}
              className="px-4 py-2 text-sm rounded-md border border-border hover:bg-muted/30 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background transition-colors"
            >
              Mais tarde
            </button>
            <button
              ref={updateBtnRef}
              onClick={download}
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary-foreground focus:ring-offset-2 focus:ring-offset-primary transition-colors flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              {status === "error" ? "Tentar novamente" : "Atualizar agora"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
