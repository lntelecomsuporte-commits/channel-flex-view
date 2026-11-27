export function isAdminPath(pathname: string) {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export function getAppManifest(pathname: string) {
  return isAdminPath(pathname) ? "/admin-manifest.json" : "/manifest.json";
}

export function needsAppEntryReload(pathname: string, entry: string | undefined, previousPathname: string) {
  const expected = isAdminPath(pathname) ? "admin" : "tv";
  const crossedBoundary = isAdminPath(pathname) !== isAdminPath(previousPathname);
  return crossedBoundary && entry !== undefined && entry !== expected;
}