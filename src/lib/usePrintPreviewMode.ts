import { useEffect } from "react";

export function usePrintPreviewMode(active: boolean) {
  useEffect(() => {
    if (!active) return;

    document.body.classList.add("print-preview-open");
    return () => {
      document.body.classList.remove("print-preview-open");
    };
  }, [active]);
}
