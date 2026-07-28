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
  /** When set, derive the live column count from the container width. */
  minItemWidth?: number;
  /** Horizontal/vertical gap between grid items. */
  gap?: number;
  /** Horizontal padding inside the scroll container. */
  horizontalPadding?: number;
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
export function useVirtualizer(
  options: UseVirtualizerOptions,
): UseVirtualizerResult {
  const {
    count,
    itemHeight,
    overscan = 3,
    columns = 1,
    minItemWidth,
    gap = 0,
    horizontalPadding = 0,
  } = options;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);
  const [containerWidth, setContainerWidth] = useState(0);

  const resolvedColumns = useMemo(() => {
    if (!minItemWidth || containerWidth <= 0) return Math.max(1, columns);
    const usableWidth = Math.max(0, containerWidth - horizontalPadding);
    return Math.max(1, Math.floor((usableWidth + gap) / (minItemWidth + gap)));
  }, [columns, containerWidth, gap, horizontalPadding, minItemWidth]);

  // Total rows needed for the item count and column layout
  const totalRows = Math.ceil(count / resolvedColumns);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Measure initial container height
    setContainerHeight(el.clientHeight || 600);
    setContainerWidth(el.clientWidth);

    const handleScroll = () => {
      setScrollTop(el.scrollTop);
    };

    el.addEventListener("scroll", handleScroll, { passive: true });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === el) {
            setContainerHeight(el.clientHeight || 600);
            setContainerWidth(el.clientWidth);
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

  const { startRow, endRow, paddingTop, paddingBottom, totalHeight } =
    useMemo(() => {
      const rowHeight = itemHeight + gap;
      const totalH = totalRows * rowHeight;

      const visibleStartRow = Math.floor(scrollTop / rowHeight);
      const visibleEndRow = Math.ceil(
        (scrollTop + containerHeight) / rowHeight,
      );

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
    }, [totalRows, itemHeight, gap, scrollTop, containerHeight, overscan]);

  const virtualItems = useMemo(() => {
    const items: VirtualItem[] = [];
    const cols = resolvedColumns;

    for (let r = startRow; r < endRow; r++) {
      for (let c = 0; c < cols; c++) {
        const itemIdx = r * cols + c;
        if (itemIdx < count) {
          items.push({
            index: itemIdx,
            offsetTop: r * (itemHeight + gap),
          });
        }
      }
    }
    return items;
  }, [startRow, endRow, resolvedColumns, count, itemHeight, gap]);

  return {
    containerRef,
    virtualItems,
    totalHeight,
    paddingTop,
    paddingBottom,
  };
}
