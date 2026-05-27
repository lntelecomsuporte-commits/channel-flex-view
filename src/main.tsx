import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { authStorageReady } from "./lib/nativeAuthStorage";
import { installGlobalUpdatePromptGuard } from "./lib/updatePromptGuard";
import { ErrorBoundary } from "./components/ErrorBoundary";

const bootStep = (label: string) => {
  try {
    (window as any).__LNTV_BOOT__?.(label);
  } catch {
    /* ignore */
  }
};

bootStep("main.tsx");
installGlobalUpdatePromptGuard();
bootStep("update-guard");

// No APK, espera a hidratação do storage nativo (Capacitor Preferences)
// antes de montar o React. Sem isso, o Supabase lê o storage vazio na
// primeira render e o usuário aparece deslogado mesmo tendo sessão salva.
bootStep("auth-storage");
authStorageReady.finally(() => {
  bootStep("react-mount");
  try {
    createRoot(document.getElementById("root")!).render(
      <ErrorBoundary>
        <App />
      </ErrorBoundary>,
    );
    // Marca "ready" só no próximo tick — dá tempo do React montar.
    setTimeout(() => bootStep("ready"), 0);
  } catch (e) {
    bootStep("react-mount-FAILED");
    throw e;
  }
});
