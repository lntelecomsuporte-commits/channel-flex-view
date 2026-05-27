import { Capacitor } from "@capacitor/core";

type LegacyWindow = Window & {
  LntvLegacy?: unknown;
};

export const isLegacyApkRuntime = (): boolean => {
  if (typeof window === "undefined") return false;
  const w = window as LegacyWindow;
  if (w.LntvLegacy) return true;
  if (window.location.search.includes("legacy=1")) return true;
  return /LNTVLegacy/i.test(navigator.userAgent || "");
};

export const isAndroidNativeRuntime = (): boolean =>
  !isLegacyApkRuntime() && Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";