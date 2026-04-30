import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { authStorageReady } from "./lib/nativeAuthStorage";

// No APK, espera a hidratação do storage nativo (Capacitor Preferences)
// antes de montar o React. Sem isso, o Supabase lê o storage vazio na
// primeira render e o usuário aparece deslogado mesmo tendo sessão salva.
authStorageReady.finally(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});
