import { Capacitor } from "@capacitor/core";
import { LOCAL_BACKEND_ORIGIN } from "@/lib/localBackend";

/**
 * Resolve uma logo_url para uma URL absoluta utilizável.
 *
 * Por que existe:
 * - No banco self-hosted, depois do cron `sync-logos`, as URLs ficam como
 *   "/logos/5.png?v=12345" (caminhos relativos servidos pelo nginx).
 * - No navegador (tv2.lntelecom.net) isso resolve sozinho contra o domínio.
 * - Dentro do APK Capacitor, o origin é `https://localhost` → o caminho
 *   relativo vira `https://localhost/logos/...` e dá 404 (ícone quebrado).
 *
 * Solução: sempre que a URL não for absoluta, prefixar com o host de produção
 * (https://tv2.lntelecom.net), que é onde o nginx serve /logos/.
 *
 * URLs absolutas (http/https) são devolvidas como estão — funcionam no web e,
 * quando o canal ainda não foi sincronizado, ainda apontam pra fonte externa.
 */
export function resolveLogoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  // já é absoluta
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
    return trimmed;
  }

  // caminho relativo — resolve contra o host correto
  const base = pickBaseOrigin();
  // garante exatamente uma barra entre base e path
  if (trimmed.startsWith("/")) return `${base}${trimmed}`;
  return `${base}/${trimmed}`;
}

function pickBaseOrigin(): string {
  // Em ambiente nativo (APK), window.location.origin é "https://localhost"
  // ou "capacitor://localhost" — inútil para servir as logos.
  if (Capacitor.isNativePlatform?.()) return LOCAL_BACKEND_ORIGIN;

  if (typeof window !== "undefined" && window.location?.origin) {
    const origin = window.location.origin;
    // No preview do Lovable também força o host real onde as logos vivem.
    try {
      const host = new URL(origin).hostname;
      if (/lovable\.(app|dev)$/i.test(host) || host === "localhost" || host.startsWith("127.")) {
        return LOCAL_BACKEND_ORIGIN;
      }
      return origin;
    } catch {
      return LOCAL_BACKEND_ORIGIN;
    }
  }

  return LOCAL_BACKEND_ORIGIN;
}
