import { useEffect, useState } from "react";

/**
 * Desktop layout breakpoint. `food-log.module.css` uses the same value in its
 * `@media (min-width: 1120px)` blocks; tests/wide-layout.test.ts keeps them equal.
 */
export const WIDE_LAYOUT_MIN_WIDTH_PX = 1120;

/**
 * Whether the viewport uses the desktop layout, or undefined until measured in
 * the browser. Callers should treat undefined as "unknown" and avoid hiding content.
 */
export function useWideLayout(): boolean | undefined {
  const [wide, setWide] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia(`(min-width: ${WIDE_LAYOUT_MIN_WIDTH_PX}px)`);
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return wide;
}
