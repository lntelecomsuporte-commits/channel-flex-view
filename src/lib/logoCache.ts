/**
 * Logo cache: stores fetched channel logos as base64 data URLs in localStorage.
 * - On first paint, returns cached data URL immediately if present.
 * - In background, revalidates by fetching the original URL and updating cache
 *   only if the bytes changed (compared via sha-1 over the response).
 * - Designed to be lightweight: revalidation is queued and throttled.
 */

const STORAGE_KEY = "ln-logo-cache:v1";
const MAX_ENTRIES = 500;
// Só revalida (consulta servidor) se a logo cacheada tem mais que isso.
// 24h: na prática a logo é servida instantaneamente do cache durante o dia,
// e só é checada uma vez por dia por logo.
const REVALIDATE_TTL_MS = 24 * 60 * 60 * 1000;

interface Entry {
  dataUrl: string;
  hash: string; // sha-1 hex of the original bytes
  ts: number; // última vez que revalidamos contra o servidor
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
      // Trim to MAX_ENTRIES (oldest first)
      const entries = Object.entries(cache);
      if (entries.length > MAX_ENTRIES) {
        entries.sort((a, b) => a[1].ts - b[1].ts);
        const trimmed: CacheMap = {};
        for (const [k, v] of entries.slice(-MAX_ENTRIES)) trimmed[k] = v;
        memCache = trimmed;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(memCache));
    } catch {
      // Quota exceeded — clear and retry once
      try {
        localStorage.removeItem(STORAGE_KEY);
        memCache = {};
      } catch { /* ignore */ }
    }
  }, 500);
}

async function sha1Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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

/** Returns cached data URL if present, or null. Synchronous. */
export function getCachedLogo(url: string): string | null {
  if (!url) return null;
  const cache = load();
  return cache[url]?.dataUrl ?? null;
}

const inflight = new Set<string>();
const queue: string[] = [];
let processing = false;

async function processQueue() {
  if (processing) return;
  processing = true;
  while (queue.length) {
    const url = queue.shift()!;
    if (inflight.has(url)) continue;
    inflight.add(url);
    try {
      await revalidateOne(url);
    } catch { /* ignore */ }
    inflight.delete(url);
    // Yield between fetches so UI stays responsive
    await new Promise((r) => setTimeout(r, 50));
  }
  processing = false;
}

async function revalidateOne(url: string) {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) return;
    const buf = await res.arrayBuffer();
    const hash = await sha1Hex(buf);
    const cache = load();
    const existing = cache[url];
    if (existing && existing.hash === hash) {
      // No change — just refresh timestamp
      existing.ts = Date.now();
      scheduleSave();
      return;
    }
    const dataUrl = bufferToDataUrl(buf, res.headers.get("content-type") || "image/png");
    cache[url] = { dataUrl, hash, ts: Date.now() };
    scheduleSave();
    // Notify listeners that this URL was updated
    listeners.forEach((cb) => cb(url, dataUrl));
  } catch {
    /* network error — keep cached version */
  }
}

/** Queue background revalidation. Cheap to call repeatedly. */
export function revalidateLogo(url: string) {
  if (!url) return;
  if (inflight.has(url) || queue.includes(url)) return;
  // Skip se já revalidamos recentemente (TTL)
  const cache = load();
  const existing = cache[url];
  if (existing && Date.now() - existing.ts < REVALIDATE_TTL_MS) return;
  queue.push(url);
  // Defer to idle to avoid blocking initial render
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
