/**
 * Resolve a logo URL para um endereço utilizável tanto no navegador quanto
 * dentro do APK (Capacitor), onde `window.location.origin` é `http://localhost`
 * e portanto URLs relativas (ex.: `/logos/foo.png`) quebram.
 *
 * Regras (LN TV self-hosted):
 * - Sempre que o caminho for relativo OU já apontar para `/logos/...` em
 *   qualquer host, força o domínio público do servidor (`PRODUCTION_HOST`).
 * - URLs absolutas externas (http(s) de outros hosts) passam como estão.
 */

const PRODUCTION_HOST = "https://tv2.lntelecom.net";

const getSiteOrigin = (): string => {
  if (typeof window === "undefined" || !window.location?.origin) {
    return PRODUCTION_HOST;
  }
  const origin = window.location.origin;
  try {
    const host = new URL(origin).hostname;
    // Em preview do Lovable ou no APK (localhost) sempre usa produção.
    if (
      /lovable\.(app|dev)$/i.test(host) ||
      host === "localhost" ||
      host === "127.0.0.1"
    ) {
      return PRODUCTION_HOST;
    }
  } catch {
    return PRODUCTION_HOST;
  }
  return origin;
};

export const resolveLogoUrl = (
  logoUrl: string | null | undefined,
): string | null => {
  if (!logoUrl) return null;
  const trimmed = logoUrl.trim();
  if (!trimmed) return null;

  // Caminho relativo direto do nginx (/logos/...).
  if (trimmed.startsWith("/")) {
    return `${getSiteOrigin()}${trimmed}`;
  }

  // URLs absolutas — se apontam para /logos/ de qualquer host, normaliza.
  try {
    const parsed = new URL(trimmed);
    if (parsed.pathname.startsWith("/logos/")) {
      return `${getSiteOrigin()}${parsed.pathname}${parsed.search}`;
    }
    return parsed.toString();
  } catch {
    return trimmed;
  }
};