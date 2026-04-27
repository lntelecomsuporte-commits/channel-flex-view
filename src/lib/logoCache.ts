/**
 * Logo cache: stores fetched channel logos as base64 data URLs in localStorage.
 *
 * Strategy: VERSION-BASED (não usa tempo).
 * - Cada entrada guarda a "versão" do canal (channel.updated_at).
 * - Quando o app carrega a lista de canais, chamamos `primeLogoVersions(channels)`
 *   passando { url, version } de cada logo.
 * - Se a versão local == versão do servidor → usa cache para sempre, ZERO requests.
 * - Se a versão mudou (admin trocou logo, URL ou qualquer campo do canal) → baixa de novo.
 * - Se não existe no cache (primeira instalação) → baixa.
 *
 * Resultado: depois da primeira carga, abrir/rolar a lista é instantâneo
 * sem nenhum tráfego de rede. Só re-baixa quando algo muda no painel.
 */

const STORAGE_KEY = "ln-logo-cache:v2";
const MAX_ENTRIES = 500;

interface Entry {
  dataUrl: string;
  version: string; // channel.updated_at (ou outro identificador de versão)
  ts: number;
}

type CacheMap = Record<string, Entry>;

let memCache: CacheMap | null = null;

function load(): CacheMap {
  if (memCache) return memCache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    memCache = raw ? (JSON.parse(raw) as CacheMap) : {};
  } catch {
    memCache = {};
  }
  return memCache!;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const cache = load();
      const entries = Object.entries(cache);
      if (entries.length > MAX_ENTRIES) {
        entries.sort((a, b) => a[1].ts - b[1].ts);
        const trimmed: CacheMap = {};
        for (const [k, v] of entries.slice(-MAX_ENTRIES)) trimmed[k] = v;
        memCache = trimmed;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(memCache));
    } catch {
      try {
        localStorage.removeItem(STORAGE_KEY);
        memCache = {};
      } catch { /* ignore */ }
    }
  }, 500);
}

function bufferToDataUrl(buf: ArrayBuffer, contentType: string): string {
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  const b64 = btoa(binary);
  const mime = contentType || "image/png";
  return `data:${mime};base64,${b64}`;
}

/** Retorna data URL cacheado se presente. Síncrono. */
export function getCachedLogo(url: string): string | null {
  if (!url) return null;
  const cache = load();
  return cache[url]?.dataUrl ?? null;
}

const inflight = new Set<string>();
const queue: Array<{ url: string; version: string }> = [];
let processing = false;

async function processQueue() {
  if (processing) return;
  processing = true;
  while (queue.length) {
    const item = queue.shift()!;
    if (inflight.has(item.url)) continue;
    inflight.add(item.url);
    try {
      await downloadOne(item.url, item.version);
    } catch { /* ignore */ }
    inflight.delete(item.url);
    await new Promise((r) => setTimeout(r, 50));
  }
  processing = false;
}

async function downloadOne(url: string, version: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const buf = await res.arrayBuffer();
    const cache = load();
    const dataUrl = bufferToDataUrl(buf, res.headers.get("content-type") || "image/png");
    cache[url] = { dataUrl, version, ts: Date.now() };
    scheduleSave();
    listeners.forEach((cb) => cb(url, dataUrl));
  } catch {
    /* network error — keep cached version */
  }
}

/**
 * Recebe a lista de logos com suas versões (ex: channel.updated_at).
 * Para cada uma:
 *  - Se não está em cache → baixa.
 *  - Se está em cache mas versão diferente → baixa de novo.
 *  - Se versão igual → faz NADA (zero rede).
 *
 * Chame isto UMA vez quando a lista de canais carregar.
 */
export function primeLogoVersions(items: Array<{ url: string | null | undefined; version: string | null | undefined }>) {
  const cache = load();
  let queued = 0;
  const appOrigin = typeof window !== "undefined" ? window.location.origin : "";
  for (const item of items) {
    if (!item.url) continue;
    if (!item.url.startsWith(appOrigin) && !item.url.startsWith("/")) continue;
    const version = item.version || "";
    const existing = cache[item.url];
    if (existing && existing.version === version) continue; // já está atualizado
    if (inflight.has(item.url) || queue.some((q) => q.url === item.url)) continue;
    queue.push({ url: item.url, version });
    queued++;
  }
  if (queued === 0) return;
  if ("requestIdleCallback" in window) {
    (window as any).requestIdleCallback(() => processQueue(), { timeout: 2000 });
  } else {
    setTimeout(processQueue, 200);
  }
}

type Listener = (url: string, dataUrl: string) => void;
const listeners = new Set<Listener>();
export function subscribeLogo(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Limpa todo o cache de logos. Útil para botão "atualizar logos" no admin. */
export function clearLogoCache() {
  memCache = {};
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
