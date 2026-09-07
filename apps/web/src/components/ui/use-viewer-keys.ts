import { useEffect, type RefObject } from 'react';

const NAVIGATION_BLOCKING_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'VIDEO', 'AUDIO']);

export const blocksViewerNavigation = (target: EventTarget | null): boolean => {
  if (target === null || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return NAVIGATION_BLOCKING_TAGS.has(target.tagName);
};

interface ViewerKeysOptions {
  containerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
}

export const useViewerKeys = ({ containerRef, onClose, onPrevious, onNext }: ViewerKeysOptions): void => {
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      const container = containerRef.current;
      if (container !== null && event.target instanceof Node && !container.contains(event.target)) return;
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (blocksViewerNavigation(event.target)) return;
      if (event.key === 'ArrowLeft' && onPrevious !== null) onPrevious();
      if (event.key === 'ArrowRight' && onNext !== null) onNext();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [containerRef, onClose, onNext, onPrevious]);
};
