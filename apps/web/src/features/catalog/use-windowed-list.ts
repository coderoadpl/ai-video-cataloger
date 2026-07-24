import { useCallback, useMemo, useRef, useState, type UIEvent } from 'react';

export interface WindowedRangeInput {
  rowHeights: readonly number[];
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

const prefixOffsets = (rowHeights: readonly number[]): number[] => {
  const offsets = new Array<number>(rowHeights.length + 1);
  offsets[0] = 0;
  for (let index = 0; index < rowHeights.length; index += 1) {
    offsets[index + 1] = (offsets[index] ?? 0) + Math.max(1, rowHeights[index] ?? 1);
  }
  return offsets;
};

export const windowedRange = ({
  rowHeights,
  viewportHeight,
  scrollTop,
  overscan,
}: WindowedRangeInput): WindowedRange => {
  const count = rowHeights.length;
  const safeOverscan = Math.max(0, Math.floor(overscan));
  const offsets = prefixOffsets(rowHeights);
  const totalHeight = offsets[count] ?? 0;
  const safeViewportHeight = Math.max(0, viewportHeight);
  const maxScrollTop = Math.max(0, totalHeight - safeViewportHeight);
  const clampedScrollTop = Math.min(Math.max(0, scrollTop), maxScrollTop);
  const viewportBottom = clampedScrollTop + safeViewportHeight;

  let firstVisible = count;
  for (let index = 0; index < count; index += 1) {
    if ((offsets[index + 1] ?? 0) > clampedScrollTop) {
      firstVisible = index;
      break;
    }
  }
  let lastVisible = 0;
  for (let index = count - 1; index >= 0; index -= 1) {
    if ((offsets[index] ?? 0) < viewportBottom) {
      lastVisible = index + 1;
      break;
    }
  }

  const start = Math.max(0, Math.min(firstVisible - safeOverscan, count));
  const end = Math.min(count, Math.max(lastVisible + safeOverscan, start));
  return { start, end, offsetTop: offsets[start] ?? 0, totalHeight };
};

export const useWindowedList = (rowHeights: readonly number[], overscan = 6) => {
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);

  const containerRef = useCallback((element: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (element === null) return;
    setViewportHeight(element.clientHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      setViewportHeight(element.clientHeight);
      setScrollTop(element.scrollTop);
    });
    observer.observe(element);
    observerRef.current = observer;
  }, []);

  const onScroll = useCallback((event: UIEvent<HTMLElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
    setViewportHeight(event.currentTarget.clientHeight);
  }, []);

  const range = useMemo(
    () => windowedRange({ rowHeights, viewportHeight, scrollTop, overscan }),
    [rowHeights, overscan, scrollTop, viewportHeight],
  );
  return { range, onScroll, containerRef };
};
