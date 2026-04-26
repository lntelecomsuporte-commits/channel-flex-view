import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { getCachedLogo, subscribeLogo } from "@/lib/logoCache";

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
  const [resolved, setResolved] = useState<string | null>(() =>
    src ? getCachedLogo(src) ?? src : null
  );

  useEffect(() => {
    if (!src) {
      setResolved(null);
      return;
    }
    setResolved(getCachedLogo(src) ?? src);

    const unsub = subscribeLogo((url, dataUrl) => {
      if (url === src) setResolved(dataUrl);
    });
    return unsub;
  }, [src]);

  if (!resolved) return null;
  return <img src={resolved} alt={alt} {...rest} />;
}
