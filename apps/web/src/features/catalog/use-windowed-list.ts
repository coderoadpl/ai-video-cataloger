import { useCallback, useMemo, useState, type UIEvent } from 'react';

export interface WindowedRangeInput {
  itemCount: number;
  rowHeight: number;
  viewportHeight: number;
  scrollTop: number;
  overscan: number;
}

export interface WindowedRange {
  start: number;
  end: number;
  offsetTop: number;
  totalHeight: number;
}

export const windowedRange = ({
  itemCount,
  rowHeight,
  viewportHeight,
  scrollTop,
  overscan,
}: WindowedRangeInput): WindowedRange => {
  const safeItemCount = Math.max(0, itemCount);
  const safeRowHeight = Math.max(1, rowHeight);
  const safeViewportHeight = Math.max(0, viewportHeight);
  const safeScrollTop = Math.max(0, scrollTop);
  const safeOverscan = Math.max(0, overscan);
  const totalHeight = safeItemCount * safeRowHeight;
  const visibleStart = Math.floor(safeScrollTop / safeRowHeight);
  const visibleEnd = Math.ceil((safeScrollTop + safeViewportHeight) / safeRowHeight);
  const start = Math.max(0, visibleStart - safeOverscan);
  const end = Math.min(safeItemCount, visibleEnd + safeOverscan);
  return { start, end, offsetTop: start * safeRowHeight, totalHeight };
};

export const useWindowedList = (itemCount: number, rowHeight: number, overscan = 6) => {
  const [viewportHeight, setViewportHeight] = useState(480);
  const [scrollTop, setScrollTop] = useState(0);
  const onScroll = useCallback((event: UIEvent<HTMLElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
    setViewportHeight(event.currentTarget.clientHeight);
  }, []);
  const range = useMemo(
    () => windowedRange({ itemCount, rowHeight, viewportHeight, scrollTop, overscan }),
    [itemCount, rowHeight, overscan, scrollTop, viewportHeight],
  );
  return { range, onScroll };
};
