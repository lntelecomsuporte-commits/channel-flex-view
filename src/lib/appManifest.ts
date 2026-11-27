export function isAdminPath(pathname: string) {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export function getAppManifest(pathname: string) {
  return isAdminPath(pathname) ? "/admin-manifest.json" : "/manifest.json";
}