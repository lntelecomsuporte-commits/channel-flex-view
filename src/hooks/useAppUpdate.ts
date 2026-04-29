import { useEffect, useState, useCallback } from "react";

/**
 * Verifica periodicamente se há uma nova versão do APK disponível.
 * Funciona apenas dentro do app Capacitor (Android). No browser web, é no-op.
 *
 * Servidor deve expor `/version.json` com formato:
 * {
 *   "versionCode": 5,
 *   "versionName": "1.2.3",
 *   "url": "https://tv2.lntelecom.net/downloads/lntv-latest.apk",
 *   "notes": "Correções de performance"
 * }
 */

export interface RemoteVersion {
  versionCode: number;
  versionName: string;
  url: string;
  notes?: string;
}

export type UpdateStatus = "idle" | "downloading" | "installing" | "error";

interface UseAppUpdateResult {
  available: RemoteVersion | null;
  currentVersionCode: number | null;
  dismiss: () => void;
  download: () => void;
  status: UpdateStatus;
  progress: number; // 0..100
  error: string | null;
}

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 min
const VERSION_JSON_URL = "/version.json";
const PRODUCTION_VERSION_JSON_URL = "https://tv2.lntelecom.net/version.json";
const DISMISSED_KEY = "lntv:update:dismissed:versionCode";

async function isNativeApp(): Promise<boolean> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

async function getCurrentVersionCode(): Promise<number | null> {
  try {
    const { App } = await import("@capacitor/app");
    const info = await App.getInfo();
    // info.build é string com o versionCode no Android
    const code = parseInt(info.build, 10);
    return Number.isFinite(code) ? code : null;
  } catch {
    return null;
  }
}

async function fetchRemoteVersion(): Promise<RemoteVersion | null> {
  const urls = (await isNativeApp())
    ? [PRODUCTION_VERSION_JSON_URL]
    : [VERSION_JSON_URL, PRODUCTION_VERSION_JSON_URL];

  for (const url of urls) {
    try {
      const joiner = url.includes("?") ? "&" : "?";
      const res = await fetch(`${url}${joiner}t=${Date.now()}`, {
        cache: "no-store",
      });
      if (!res.ok) continue;
      const data = (await res.json()) as RemoteVersion;
      if (typeof data.versionCode !== "number" || !data.url) continue;
      return data;
    } catch {
      /* tenta a próxima URL */
    }
  }

  return null;
}

export function useAppUpdate(): UseAppUpdateResult {
  const [available, setAvailable] = useState<RemoteVersion | null>(null);
  const [currentVersionCode, setCurrentVersionCode] = useState<number | null>(null);
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    if (!(await isNativeApp())) return;
    const current = await getCurrentVersionCode();
    if (current === null) return;
    setCurrentVersionCode(current);

    const remote = await fetchRemoteVersion();
    if (!remote) return;

    if (remote.versionCode <= current) {
      setAvailable(null);
      return;
    }

    try {
      const dismissed = parseInt(localStorage.getItem(DISMISSED_KEY) || "0", 10);
      if (dismissed === remote.versionCode) return;
    } catch {
      /* noop */
    }

    setAvailable(remote);
  }, []);

  useEffect(() => {
    check();
    const id = window.setInterval(check, CHECK_INTERVAL_MS);
    let appStateListener: { remove: () => Promise<void> } | null = null;

    import("@capacitor/app")
      .then(({ App }) =>
        App.addListener("resume", () => {
          check();
        }),
      )
      .then((listener) => {
        appStateListener = listener;
      })
      .catch(() => {
        /* browser web */
      });

    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      appStateListener?.remove();
    };
  }, [check]);

  const dismiss = useCallback(() => {
    if (available) {
      try {
        localStorage.setItem(DISMISSED_KEY, String(available.versionCode));
      } catch {
        /* noop */
      }
    }
    setAvailable(null);
    setStatus("idle");
    setProgress(0);
    setError(null);
  }, [available]);

  const download = useCallback(async () => {
    if (!available) return;

    // Web (PWA): só abre no navegador.
    if (!(await isNativeApp())) {
      window.open(available.url, "_blank");
      return;
    }

    setStatus("downloading");
    setProgress(0);
    setError(null);

    try {
      // 1) Baixa o APK em streaming pra acompanhar progresso.
      const res = await fetch(available.url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get("Content-Length") || 0);

      const reader = res.body?.getReader();
      if (!reader) throw new Error("Stream não suportado");

      const chunks: Uint8Array[] = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.length;
          if (total > 0) {
            setProgress(Math.min(99, Math.round((received / total) * 100)));
          }
        }
      }

      // 2) Concatena e converte pra base64 (em pedaços pra não estourar a stack).
      const blob = new Blob(chunks as BlobPart[], { type: "application/vnd.android.package-archive" });
      const base64 = await blobToBase64(blob);
      setProgress(100);

      // 3) Salva no cache do app.
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const fileName = `lntv-update-${available.versionCode}.apk`;
      const writeRes = await Filesystem.writeFile({
        path: fileName,
        data: base64,
        directory: Directory.Cache,
      });

      // 4) Dispara o instalador nativo do Android.
      setStatus("installing");
      const { FileOpener } = await import("@capacitor-community/file-opener");
      await FileOpener.open({
        filePath: writeRes.uri,
        contentType: "application/vnd.android.package-archive",
      });
      // Não voltamos pra "idle" — o sistema assume e mostra o prompt de install.
    } catch (e) {
      console.error("[useAppUpdate] download failed", e);
      setError(e instanceof Error ? e.message : "Erro desconhecido");
      setStatus("error");
      // Fallback: abre no navegador pra usuário baixar manualmente.
      try {
        window.open(available.url, "_blank");
      } catch {
        /* noop */
      }
    }
  }, [available]);

  return { available, currentVersionCode, dismiss, download, status, progress, error };
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = reader.result as string;
      // result = "data:...;base64,XXXX" — pega só a parte XXXX
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}
