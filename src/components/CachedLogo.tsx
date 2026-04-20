import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { getCachedLogo, revalidateLogo, subscribeLogo } from "@/lib/logoCache";

interface CachedLogoProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src: string | null | undefined;
  alt: string;
}

/**
 * <img> wrapper that:
 * - Uses cached data URL synchronously if available (no flash, no network).
 * - Falls back to the original URL while cache populates in background.
 * - Schedules a background revalidation to detect logo changes on the server.
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
    const cached = getCachedLogo(src);
    setResolved(cached ?? src);

    // Always queue revalidation — updates cache only if bytes changed
    revalidateLogo(src);

    const unsub = subscribeLogo((url, dataUrl) => {
      if (url === src) setResolved(dataUrl);
    });
    return unsub;
  }, [src]);

  if (!resolved) return null;
  return <img src={resolved} alt={alt} {...rest} />;
}
