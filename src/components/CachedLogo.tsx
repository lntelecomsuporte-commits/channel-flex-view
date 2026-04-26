import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { getCachedLogo, subscribeLogo } from "@/lib/logoCache";
import { resolveLogoUrl } from "@/lib/logoUrl";

interface CachedLogoProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src: string | null | undefined;
  alt: string;
}

/**
 * <img> wrapper that:
 * - Uses cached data URL synchronously if available (no flash, no network).
 * - Falls back to original URL while cache populates.
 * - Does NOT trigger revalidation by itself — that is handled centrally
 *   by primeLogoVersions() when the channel list loads.
 */
export function CachedLogo({ src, alt, ...rest }: CachedLogoProps) {
  // Sempre normaliza para URL absoluta (no APK Capacitor o origin é localhost,
  // então caminhos relativos como "/logos/5.png" precisam ser reescritos para
  // https://tv2.lntelecom.net/logos/5.png).
  const resolvedSrc = resolveLogoUrl(src);

  const [resolved, setResolved] = useState<string | null>(() =>
    resolvedSrc ? getCachedLogo(resolvedSrc) ?? resolvedSrc : null
  );

  useEffect(() => {
    if (!resolvedSrc) {
      setResolved(null);
      return;
    }
    setResolved(getCachedLogo(resolvedSrc) ?? resolvedSrc);

    const unsub = subscribeLogo((url, dataUrl) => {
      if (url === resolvedSrc) setResolved(dataUrl);
    });
    return unsub;
  }, [resolvedSrc]);

  if (!resolved) return null;
  return <img src={resolved} alt={alt} {...rest} />;
}
