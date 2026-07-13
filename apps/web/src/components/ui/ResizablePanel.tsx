import { useRef, type PointerEvent, type ReactNode } from 'react';
import { Box } from '@mui/material';

interface ResizablePanelProps {
  direction: 'horizontal' | 'vertical';
  size: number;
  minSize: number;
  maxSize: number;
  collapsed?: boolean;
  onResize: (size: number) => void;
  children: ReactNode;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * Mouse-resizable panel. `horizontal` sizes width with a handle on the right
 * edge; `vertical` sizes height with a handle on the top edge (used by the
 * bottom terminal, so dragging up grows it). Collapsed pins the size to 0.
 */
export const ResizablePanel = ({
  direction,
  size,
  minSize,
  maxSize,
  collapsed = false,
  onResize,
  children,
}: ResizablePanelProps) => {
  const horizontal = direction === 'horizontal';
  const dragging = useRef(false);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragging.current = true;
    const startCoord = horizontal ? event.clientX : event.clientY;
    const startSize = size;

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      if (!dragging.current) return;
      const delta = horizontal
        ? moveEvent.clientX - startCoord
        : startCoord - moveEvent.clientY;
      onResize(clamp(startSize + delta, minSize, maxSize));
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const effectiveSize = collapsed ? 0 : size;

  return (
    <Box
      sx={{
        position: 'relative',
        flexShrink: 0,
        overflow: 'hidden',
        ...(horizontal ? { width: effectiveSize } : { height: effectiveSize }),
      }}
    >
      {collapsed ? null : (
        <Box
          role="separator"
          aria-orientation={horizontal ? 'vertical' : 'horizontal'}
          onPointerDown={onPointerDown}
          sx={{
            position: 'absolute',
            zIndex: 2,
            ...(horizontal
              ? { top: 0, bottom: 0, right: 0, width: 5, cursor: 'col-resize' }
              : { left: 0, right: 0, top: 0, height: 5, cursor: 'row-resize' }),
            '&:hover': { bgcolor: 'primary.main', opacity: 0.4 },
          }}
        />
      )}
      {children}
    </Box>
  );
};
