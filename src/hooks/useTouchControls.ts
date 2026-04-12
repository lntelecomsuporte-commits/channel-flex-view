import { useRef, useCallback } from "react";

interface UseTouchControlsOptions {
  onSwipeUp: () => void;
  onSwipeDown: () => void;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  onTap: () => void;
  minSwipeDistance?: number;
}

export function useTouchControls({
  onSwipeUp,
  onSwipeDown,
  onSwipeLeft,
  onSwipeRight,
  onTap,
  minSwipeDistance = 50,
}: UseTouchControlsOptions) {
  const touchStart = useRef<{ x: number; y: number; time: number } | null>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  }, []);

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!touchStart.current) return;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - touchStart.current.x;
      const dy = touch.clientY - touchStart.current.y;
      const elapsed = Date.now() - touchStart.current.time;
      touchStart.current = null;

      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      // Tap detection: short distance + short time
      if (absDx < 15 && absDy < 15 && elapsed < 300) {
        onTap();
        return;
      }

      if (absDx < minSwipeDistance && absDy < minSwipeDistance) return;

      if (absDy > absDx) {
        // Vertical swipe
        if (dy < 0) onSwipeUp();
        else onSwipeDown();
      } else {
        // Horizontal swipe
        if (dx > 0) onSwipeRight();
        else onSwipeLeft();
      }
    },
    [onSwipeUp, onSwipeDown, onSwipeLeft, onSwipeRight, onTap, minSwipeDistance]
  );

  return { onTouchStart, onTouchEnd };
}
