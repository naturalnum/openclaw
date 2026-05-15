import { useLayoutEffect, useRef } from "react";

import "../../styles.css";
import "../../app.ts";

type PowerWorkbenchHostProps = {
  /** When false, skip mounting (e.g. keep tab alive but hidden). Default true. */
  active?: boolean;
};

/**
 * Isolated host for the Lit `<openclaw-power-app>` workbench (parity with `index.html`).
 * Side-effect imports register the custom element and attach global styles.
 */
export function PowerWorkbenchHost({ active = true }: PowerWorkbenchHostProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!active) {
      return;
    }
    const root = containerRef.current;
    if (!root) {
      return;
    }
    const el = document.createElement("openclaw-power-app");
    root.appendChild(el);
    return () => {
      if (el.parentNode === root) {
        root.removeChild(el);
      }
    };
  }, [active]);

  return (
    <div
      ref={containerRef}
      className="power-react-workbench-host"
      style={{
        flex: 1,
        minHeight: 0,
        width: "100%",
        margin: 0,
        overflow: "hidden",
      }}
    />
  );
}
