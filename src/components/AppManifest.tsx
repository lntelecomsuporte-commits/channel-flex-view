import { useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";
import { getAppManifest, isAdminPath } from "@/lib/appManifest";

// Metadata only: neither app registers an offline/app-shell worker here.
export function AppManifest() {
  const { pathname } = useLocation();

  useLayoutEffect(() => {
    const admin = isAdminPath(pathname);
    document.querySelector('link[rel="manifest"]')?.setAttribute("href", getAppManifest(pathname));
    document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute("href", admin ? "/admin-icon-192.png" : "/logo.png");
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", admin ? "LN TV Admin" : "LN TV");
    document.title = admin ? "LN TV Admin - Painel de Administração" : "LN TV - Assista canais ao vivo";
    document.body.classList.toggle("admin-mode", admin);
    return () => document.body.classList.remove("admin-mode");
  }, [pathname]);

  return null;
}