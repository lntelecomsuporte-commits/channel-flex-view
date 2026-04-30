import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

/**
 * Storage adapter para o Supabase Auth.
 *
 * - No APK (Capacitor native): usa @capacitor/preferences, que persiste em
 *   SharedPreferences (Android) / UserDefaults (iOS). Sobrevive a limpeza
 *   de cache do WebView, hibernação, e atualizações do app — diferente do
 *   localStorage do WebView, que pode ser apagado pelo sistema.
 * - No web/PWA: usa localStorage normal.
 *
 * Para evitar que a primeira leitura assíncrona dispare logout, o adapter
 * pré-carrega as chaves conhecidas em memória de forma síncrona-ish (via
 * top-level await na inicialização do módulo) e mantém um cache que o
 * Supabase consome de forma síncrona.
 */

const isNative = Capacitor.isNativePlatform();

// Cache em memória para leitura síncrona (Supabase chama getItem síncrono)
const memCache = new Map<string, string>();
let hydrated = false;

const KNOWN_KEYS = ["lntv-local-auth-token"];

async function hydrate() {
  if (hydrated || !isNative) return;
  for (const key of KNOWN_KEYS) {
    try {
      const { value } = await Preferences.get({ key });
      if (value) memCache.set(key, value);
    } catch (e) {
      console.warn("[nativeAuthStorage] hydrate fail", key, e);
    }
  }
  hydrated = true;
}

// Promise exportada para o bootstrap esperar antes de criar o client
export const authStorageReady: Promise<void> = isNative ? hydrate() : Promise.resolve();

export const nativeAuthStorage = {
  getItem: (key: string): string | null => {
    if (!isNative) return localStorage.getItem(key);
    return memCache.get(key) ?? null;
  },
  setItem: (key: string, value: string): void => {
    if (!isNative) {
      localStorage.setItem(key, value);
      return;
    }
    memCache.set(key, value);
    // fire-and-forget — persistência nativa
    Preferences.set({ key, value }).catch((e) =>
      console.warn("[nativeAuthStorage] setItem fail", key, e)
    );
  },
  removeItem: (key: string): void => {
    if (!isNative) {
      localStorage.removeItem(key);
      return;
    }
    memCache.delete(key);
    Preferences.remove({ key }).catch((e) =>
      console.warn("[nativeAuthStorage] removeItem fail", key, e)
    );
  },
};
