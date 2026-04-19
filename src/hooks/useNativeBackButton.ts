import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";

/**
 * Intercepts the hardware/remote Back button on native (Android TV / Android).
 * Calls `handler` and prevents the app from being closed.
 * Returns true from handler if you handled it; false to allow default (exit app).
 */
export function useNativeBackButton(handler: () => boolean, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    if (!Capacitor.isNativePlatform()) return;

    let listenerHandle: { remove: () => void } | null = null;

    App.addListener("backButton", ({ canGoBack }) => {
      const handled = handler();
      if (!handled && !canGoBack) {
        App.exitApp();
      }
    }).then((h) => {
      listenerHandle = h;
    });

    return () => {
      listenerHandle?.remove();
    };
  }, [handler, enabled]);
}
