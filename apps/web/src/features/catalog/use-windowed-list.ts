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
  const totalHeight = itemCount * rowHeight;
  const visibleStart = Math.floor(scrollTop / rowHeight);
  const visibleEnd = Math.ceil((scrollTop + viewportHeight) / rowHeight);
  const start = Math.max(0, visibleStart - overscan);
  const end = Math.min(itemCount, visibleEnd + overscan);
  return { start, end, offsetTop: start * rowHeight, totalHeight };
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
