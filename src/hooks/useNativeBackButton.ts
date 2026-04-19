import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";

/**
 * Intercepts the hardware/remote Back button on native (Android TV / Android).
 * Uses a ref so the latest handler is always invoked (avoids stale closures
 * when the user presses Back rapidly multiple times).
 */
export function useNativeBackButton(handler: () => boolean, enabled = true) {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!enabled) return;
    if (!Capacitor.isNativePlatform()) return;

    let listenerHandle: { remove: () => void } | null = null;
    let removed = false;

    App.addListener("backButton", () => {
      // Always read the latest handler from the ref
      const handled = handlerRef.current();
      if (!handled) {
        // Nothing to close — exit the app
        App.exitApp();
      }
    }).then((h) => {
      if (removed) {
        h.remove();
      } else {
        listenerHandle = h;
      }
    });

    return () => {
      removed = true;
      listenerHandle?.remove();
    };
  }, [enabled]);
}
