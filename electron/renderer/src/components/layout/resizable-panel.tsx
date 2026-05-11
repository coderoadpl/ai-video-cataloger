import * as React from 'react';
import { cn } from '@/lib/utils';

interface ResizablePanelProps {
  children: React.ReactNode;
  defaultSize: number;
  minSize: number;
  maxSize: number;
  direction: 'horizontal' | 'vertical';
  className?: string;
  collapsed?: boolean;
  onResize?: (size: number) => void;
  onCollapsedChange?: (collapsed: boolean) => void;
}

interface ResizableHandleProps {
  direction: 'horizontal' | 'vertical';
  onMouseDown: (e: React.MouseEvent) => void;
  className?: string;
}

const ResizableHandle = React.forwardRef<HTMLDivElement, ResizableHandleProps>(
  ({ direction, onMouseDown, className }, ref) => {
    return (
      <div
        ref={ref}
        onMouseDown={onMouseDown}
        className={cn(
          'group flex items-center justify-center transition-colors',
          direction === 'horizontal'
            ? 'w-1.5 cursor-col-resize hover:bg-primary/20'
            : 'h-1.5 cursor-row-resize hover:bg-primary/20',
          className
        )}
      >
        <div
          className={cn(
            'bg-border rounded-full opacity-0 group-hover:opacity-100 transition-opacity',
            direction === 'horizontal' ? 'w-0.5 h-8' : 'h-0.5 w-8'
          )}
        />
      </div>
    );
  }
);
ResizableHandle.displayName = 'ResizableHandle';

const ResizablePanel = React.forwardRef<HTMLDivElement, ResizablePanelProps>(
  (
    {
      children,
      defaultSize,
      minSize,
      maxSize,
      direction,
      className,
      collapsed = false,
      onResize,
      onCollapsedChange,
    },
    ref
  ) => {
    // Use defaultSize as initial value and track internally
    // The parent can read the size via onResize callback
    const [internalSize, setInternalSize] = React.useState(defaultSize);
    const [isDragging, setIsDragging] = React.useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);
    const startPosRef = React.useRef(0);
    const startSizeRef = React.useRef(0);

    // Sync internal size when defaultSize changes (e.g., from localStorage)
    React.useEffect(() => {
      setInternalSize(defaultSize);
    }, [defaultSize]);

    const handleMouseDown = React.useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        setIsDragging(true);
        startPosRef.current = direction === 'horizontal' ? e.clientX : e.clientY;
        startSizeRef.current = internalSize;
      },
      [direction, internalSize]
    );

    React.useEffect(() => {
      const handleMouseMove = (e: MouseEvent): void => {
        if (!isDragging) return;

        const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
        // For vertical (bottom panel), we invert the delta since dragging up should increase size
        const delta =
          direction === 'horizontal'
            ? currentPos - startPosRef.current
            : startPosRef.current - currentPos;
        const newSize = Math.min(maxSize, Math.max(minSize, startSizeRef.current + delta));

        setInternalSize(newSize);
        onResize?.(newSize);

        // Auto-collapse if dragged below minimum
        if (newSize <= minSize && onCollapsedChange) {
          onCollapsedChange(true);
        }
      };

      const handleMouseUp = (): void => {
        setIsDragging(false);
      };

      if (isDragging) {
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        // Prevent text selection while dragging
        document.body.style.userSelect = 'none';
        document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
      }

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      };
    }, [isDragging, direction, minSize, maxSize, onResize, onCollapsedChange]);

    const sizeStyle = React.useMemo(() => {
      if (collapsed) {
        return direction === 'horizontal' ? { width: 0 } : { height: 0 };
      }
      return direction === 'horizontal' ? { width: internalSize } : { height: internalSize };
    }, [collapsed, direction, internalSize]);

    return (
      <div
        ref={ref}
        className={cn('relative flex', direction === 'horizontal' ? 'flex-row' : 'flex-col')}
      >
        {direction === 'vertical' && !collapsed && (
          <ResizableHandle direction={direction} onMouseDown={handleMouseDown} />
        )}
        <div
          ref={containerRef}
          className={cn(
            'overflow-hidden transition-all duration-200',
            collapsed && 'opacity-0',
            className
          )}
          style={sizeStyle}
        >
          {children}
        </div>
        {direction === 'horizontal' && !collapsed && (
          <ResizableHandle direction={direction} onMouseDown={handleMouseDown} />
        )}
      </div>
    );
  }
);
ResizablePanel.displayName = 'ResizablePanel';

export { ResizablePanel, ResizableHandle };
export type { ResizablePanelProps, ResizableHandleProps };
