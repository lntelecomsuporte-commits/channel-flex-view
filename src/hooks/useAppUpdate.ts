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

interface UseAppUpdateResult {
  available: RemoteVersion | null;
  currentVersionCode: number | null;
  dismiss: () => void;
  download: () => void;
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

    // Respeita o "dispensar" do usuário para esta mesma versão.
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
  }, [available]);

  const download = useCallback(async () => {
    if (!available) return;
    // Abre a URL do APK no navegador padrão. Após o download, o Android
    // oferece instalar (na 1ª vez pede permissão "Instalar apps desconhecidos").
    // Como o applicationId e a assinatura são iguais, o sistema faz UPGRADE
    // preservando dados e login — não precisa desinstalar manualmente.
    window.open(available.url, "_blank");
  }, [available]);

  return { available, currentVersionCode, dismiss, download };
}
