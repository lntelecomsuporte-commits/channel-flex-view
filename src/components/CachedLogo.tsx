import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { getCachedLogo, subscribeLogo } from "@/lib/logoCache";
import { supabase } from "@/integrations/supabase/client";

interface CachedLogoProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src: string | null | undefined;
  alt: string;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

function buildProxyUrl(url: string): string {
  const endpoint = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/hls-proxy`;
  const u = new URL(endpoint);
  u.searchParams.set("url", url);
  u.searchParams.set("token", ANON_KEY);
  return u.toString();
}

/**
 * <img> wrapper that:
 * - Uses cached data URL synchronously if available (no flash, no network).
 * - Falls back to original URL while cache populates.
 * - On image load error (CORS / mixed-content / blocked in WebView/APK),
 *   retries through the hls-proxy edge function, which serves any image
 *   with permissive CORS and HTTPS — fixes broken logos inside the Capacitor APK.
 */
export function CachedLogo({ src, alt, onError, ...rest }: CachedLogoProps) {
  const [resolved, setResolved] = useState<string | null>(() =>
    src ? getCachedLogo(src) ?? src : null
  );
  const [triedProxy, setTriedProxy] = useState(false);

  useEffect(() => {
    if (!src) {
      setResolved(null);
      setTriedProxy(false);
      return;
    }
    setResolved(getCachedLogo(src) ?? src);
    setTriedProxy(false);

    const unsub = subscribeLogo((url, dataUrl) => {
      if (url === src) setResolved(dataUrl);
    });
    return unsub;
  }, [src]);

  if (!resolved) return null;
  return (
    <img
      src={resolved}
      alt={alt}
      {...rest}
      onError={(e) => {
        // If the original URL fails to load (typical in Capacitor APK due to
        // mixed-content / CORS / cleartext), retry once through our proxy.
        if (src && !triedProxy && !resolved.startsWith("data:")) {
          setTriedProxy(true);
          setResolved(buildProxyUrl(src));
          return;
        }
        onError?.(e);
      }}
    />
  );
}
