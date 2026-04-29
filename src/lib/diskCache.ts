/**
 * Cache leve em localStorage para canais e EPG.
 *
 * No APK Capacitor o localStorage do WebView é persistido em disco
 * (em /data/data/<pkg>/app_webview/Default/Local Storage/), então
 * ele sobrevive ao restart do app e é instantâneo de ler — eliminando
 * o fetch de ~570KB do EPG e a query de canais no boot.
 *
 * Estratégia: stale-while-revalidate.
 *  1) No boot, devolvemos imediatamente o cache (mesmo velho).
 *  2) Em paralelo, refazemos o fetch de rede e atualizamos.
 */

const KEY_CHANNELS = "lntv:cache:channels:v1";
const KEY_EPG_JSON = "lntv:cache:epg-json:v1";
const MAX_CHANNELS_CACHE_AGE_MS = 30_000;

interface CacheEnvelope<T> {
  ts: number;
  data: T;
}

function safeGet<T>(key: string): CacheEnvelope<T> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as CacheEnvelope<T>;
  } catch {
    return null;
  }
}

function safeSet<T>(key: string, data: T) {
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch (e) {
    // QuotaExceeded — limpa entradas antigas e tenta de novo
    try {
      localStorage.removeItem(key);
      localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
    } catch { /* desiste silenciosamente */ }
  }
}

export const channelsCache = {
  read<T = unknown>(): T | null {
    return safeGet<T>(KEY_CHANNELS)?.data ?? null;
  },
  write<T = unknown>(data: T) {
    safeSet(KEY_CHANNELS, data);
  },
  age(): number | null {
    const env = safeGet(KEY_CHANNELS);
    return env ? Date.now() - env.ts : null;
  },
  isFresh(maxAgeMs = MAX_CHANNELS_CACHE_AGE_MS): boolean {
    const age = this.age();
    return age != null && age <= maxAgeMs;
  },
  clear() {
    try { localStorage.removeItem(KEY_CHANNELS); } catch { /* noop */ }
  },
};

export const epgJsonCache = {
  read<T = unknown>(): T | null {
    return safeGet<T>(KEY_EPG_JSON)?.data ?? null;
  },
  write<T = unknown>(data: T) {
    safeSet(KEY_EPG_JSON, data);
  },
  age(): number | null {
    const env = safeGet(KEY_EPG_JSON);
    return env ? Date.now() - env.ts : null;
  },
};
