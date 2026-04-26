/**
 * URLs locais do cache EPG servido pelo nginx (mesmo domínio, sem CORS).
 *
 * O servidor sincroniza periodicamente (scripts/sync-epg.mjs) baixando todas
 * as URLs salvas em `epg_url_presets` para `public/epg/sources/<slug>.xml`
 * e gera `public/epg/lntv.xml` consolidado só com nossos canais.
 */
import { Capacitor } from "@capacitor/core";
import { createHash } from "@/lib/hash";

const PRODUCTION_HOST = "https://tv2.lntelecom.net";

export const getEpgBaseUrl = (): string => {
  if (Capacitor.isNativePlatform()) return PRODUCTION_HOST;
  if (typeof window !== "undefined" && window.location?.origin) {
    const winOrigin = window.location.origin;
    if (!/lovable\.(app|dev)$/i.test(new URL(winOrigin).hostname)) {
      return winOrigin;
    }
  }
  return PRODUCTION_HOST;
};

/** URL do XML consolidado dos nossos canais (sempre pequeno e atualizado). */
export const getConsolidatedEpgUrl = (): string => `${getEpgBaseUrl()}/epg/lntv.xml`;

/** URL do JSON pré-parseado — o APK só faz JSON.parse (super rápido). */
export const getConsolidatedEpgJsonUrl = (): string => `${getEpgBaseUrl()}/epg/lntv.json`;

/** URL de uma fonte EPG cacheada localmente (mesmo slug do sync-epg.mjs). */
export const getLocalSourceUrl = (sourceUrl: string): string =>
  `${getEpgBaseUrl()}/epg/sources/${urlToSlug(sourceUrl)}`;

/** Converte URL remota em nome de arquivo (igual scripts/sync-epg.mjs). */
export function urlToSlug(url: string): string {
  const h = createHash(url).slice(0, 8);
  const name = url
    .replace(/^https?:\/\//, "")
    .replace(/\/+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(-60);
  return `${name}-${h}.xml`;
}
