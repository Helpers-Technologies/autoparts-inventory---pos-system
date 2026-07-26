import { useEffect, useRef, useState, useMemo } from "react";

interface UseVirtualizerOptions {
  /** Total number of items in the list/grid */
  count: number;
  /** Estimated height of each item (or row) in pixels */
  itemHeight: number;
  /** Number of extra rows to render above and below the visible viewport */
  overscan?: number;
  /** Number of grid columns (1 for single-column list) */
  columns?: number;
}

interface VirtualItem {
  index: number;
  offsetTop: number;
}

interface UseVirtualizerResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  virtualItems: VirtualItem[];
  totalHeight: number;
  paddingTop: number;
  paddingBottom: number;
}

/**
 * Headless virtualization hook for lists and grid layouts.
 * Computes visible range based on scroll position and renders only active rows.
 */
export function useVirtualizer(options: UseVirtualizerOptions): UseVirtualizerResult {
  const { count, itemHeight, overscan = 3, columns = 1 } = options;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  // Total rows needed for the item count and column layout
  const totalRows = Math.ceil(count / Math.max(1, columns));

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Measure initial container height
    setContainerHeight(el.clientHeight || 600);

    const handleScroll = () => {
      setScrollTop(el.scrollTop);
    };

    el.addEventListener("scroll", handleScroll, { passive: true });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === el) {
            setContainerHeight(entry.contentRect.height || 600);
          }
        }
      });
      resizeObserver.observe(el);
    }

    return () => {
      el.removeEventListener("scroll", handleScroll);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, []);

  const { startRow, endRow, paddingTop, paddingBottom, totalHeight } = useMemo(() => {
    const rowHeight = itemHeight;
    const totalH = totalRows * rowHeight;

    const visibleStartRow = Math.floor(scrollTop / rowHeight);
    const visibleEndRow = Math.ceil((scrollTop + containerHeight) / rowHeight);

    const sRow = Math.max(0, visibleStartRow - overscan);
    const eRow = Math.min(totalRows, visibleEndRow + overscan);

    const topPad = sRow * rowHeight;
    const botPad = Math.max(0, (totalRows - eRow) * rowHeight);

    return {
      startRow: sRow,
      endRow: eRow,
      paddingTop: topPad,
      paddingBottom: botPad,
      totalHeight: totalH,
    };
  }, [count, totalRows, itemHeight, scrollTop, containerHeight, overscan]);

  const virtualItems = useMemo(() => {
    const items: VirtualItem[] = [];
    const cols = Math.max(1, columns);

    for (let r = startRow; r < endRow; r++) {
      for (let c = 0; c < cols; c++) {
        const itemIdx = r * cols + c;
        if (itemIdx < count) {
          items.push({
            index: itemIdx,
            offsetTop: r * itemHeight,
          });
        }
      }
    }
    return items;
  }, [startRow, endRow, columns, count, itemHeight]);

  return {
    containerRef,
    virtualItems,
    totalHeight,
    paddingTop,
    paddingBottom,
  };
}
