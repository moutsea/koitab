"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function DismissibleMenu({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function dismissOutside(event: Event) {
      const menu = ref.current;
      if (
        menu?.open &&
        event.target instanceof Node &&
        !menu.contains(event.target)
      ) {
        menu.open = false;
      }
    }
    function dismissWithEscape(event: KeyboardEvent) {
      const menu = ref.current;
      if (event.key === "Escape" && menu?.open) {
        menu.open = false;
        menu.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", dismissWithEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", dismissWithEscape);
    };
  }, []);

  return (
    <details ref={ref} className={className}>
      {children}
    </details>
  );
}
