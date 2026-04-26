import { useEffect, useMemo, useState, type ImgHTMLAttributes } from "react";
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
  const normalizedSrc = useMemo(() => resolveLogoUrl(src), [src]);
  const [resolved, setResolved] = useState<string | null>(() =>
    normalizedSrc ? getCachedLogo(normalizedSrc) ?? normalizedSrc : null
  );

  useEffect(() => {
    if (!normalizedSrc) {
      setResolved(null);
      return;
    }
    setResolved(getCachedLogo(normalizedSrc) ?? normalizedSrc);

    const unsub = subscribeLogo((url, dataUrl) => {
      if (url === normalizedSrc) setResolved(dataUrl);
    });
    return unsub;
  }, [normalizedSrc]);

  if (!resolved) return null;
  return <img src={resolved} alt={alt} {...rest} />;
}
