import { Capacitor } from "@capacitor/core";

/**
 * Storage adapter para o Supabase Auth.
 *
 * - APK (Capacitor): tenta usar @capacitor/preferences (persiste em
 *   SharedPreferences/UserDefaults). Se o plugin falhar/travar, cai pro
 *   localStorage do WebView pra não bloquear o boot do app.
 * - Web/PWA: localStorage normal.
 *
 * IMPORTANTE: import dinâmico do Preferences e timeout curto na hidratação
 * pra garantir que NUNCA bloqueie o boot — em alguns Android/WebViews
 * antigos a chamada nativa pode travar e travava o app em tela preta.
 */

const isNative = Capacitor.isNativePlatform();

const memCache = new Map<string, string>();
let hydrated = false;
let prefsApi: any = null;

const KNOWN_KEYS = ["lntv-local-auth-token"];

const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`[nativeAuthStorage] timeout ${label}`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });

async function hydrate() {
  if (hydrated || !isNative) return;
  try {
    const mod = await withTimeout(import("@capacitor/preferences"), 1500, "import");
    prefsApi = mod.Preferences;
  } catch (e) {
    console.warn("[nativeAuthStorage] Preferences indisponível, usando localStorage", e);
    hydrated = true;
    return;
  }

  for (const key of KNOWN_KEYS) {
    try {
      const { value } = await withTimeout(prefsApi.get({ key }), 1500, `get ${key}`);
      if (value) memCache.set(key, value);
      else {
        // fallback: tenta migrar do localStorage se houver
        try {
          const ls = localStorage.getItem(key);
          if (ls) {
            memCache.set(key, ls);
            prefsApi.set({ key, value: ls }).catch(() => {});
          }
        } catch {}
      }
    } catch (e) {
      console.warn("[nativeAuthStorage] hydrate fail, fallback localStorage", key, e);
      try {
        const ls = localStorage.getItem(key);
        if (ls) memCache.set(key, ls);
      } catch {}
    }
  }
  hydrated = true;
}

// Boot NUNCA pode bloquear. Limite duro de 3s — se passar, segue sem hydrate.
export const authStorageReady: Promise<void> = isNative
  ? withTimeout(hydrate(), 3000, "hydrate-global").catch((e) => {
      console.warn("[nativeAuthStorage] hydrate abortado", e);
    })
  : Promise.resolve();

export const nativeAuthStorage = {
  getItem: (key: string): string | null => {
    if (!isNative) return localStorage.getItem(key);
    if (memCache.has(key)) return memCache.get(key) ?? null;
    // último recurso: localStorage do WebView
    try { return localStorage.getItem(key); } catch { return null; }
  },
  setItem: (key: string, value: string): void => {
    if (!isNative) {
      localStorage.setItem(key, value);
      return;
    }
    memCache.set(key, value);
    try { localStorage.setItem(key, value); } catch {}
    if (prefsApi) {
      prefsApi.set({ key, value }).catch((e: any) =>
        console.warn("[nativeAuthStorage] setItem fail", key, e)
      );
    }
  },
  removeItem: (key: string): void => {
    if (!isNative) {
      localStorage.removeItem(key);
      return;
    }
    memCache.delete(key);
    try { localStorage.removeItem(key); } catch {}
    if (prefsApi) {
      prefsApi.remove({ key }).catch((e: any) =>
        console.warn("[nativeAuthStorage] removeItem fail", key, e)
      );
    }
  },
};
