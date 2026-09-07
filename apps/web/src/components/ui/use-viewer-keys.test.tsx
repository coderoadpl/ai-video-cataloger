import { useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { blocksViewerNavigation, useViewerKeys } from './use-viewer-keys.js';

const Harness = ({
  onClose,
  onPrevious,
  onNext,
}: {
  onClose: () => void;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useViewerKeys({ containerRef, onClose, onPrevious, onNext });
  return (
    <div ref={containerRef} data-testid="viewer">
      <video data-testid="player"><track kind="captions" /></video>
      <input data-testid="field" />
    </div>
  );
};

const renderHarness = () => {
  const handlers = { onClose: vi.fn(), onPrevious: vi.fn(), onNext: vi.fn() };
  render(<Harness {...handlers} />);
  return handlers;
};

describe('useViewerKeys', () => {
  it('navigates on arrow keys raised inside the viewer surface', () => {
    const handlers = renderHarness();
    fireEvent.keyDown(screen.getByTestId('viewer'), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByTestId('viewer'), { key: 'ArrowLeft' });
    expect(handlers.onNext).toHaveBeenCalledTimes(1);
    expect(handlers.onPrevious).toHaveBeenCalledTimes(1);
  });

  it('leaves arrow keys to the focused video control instead of changing file', () => {
    const handlers = renderHarness();
    fireEvent.keyDown(screen.getByTestId('player'), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByTestId('field'), { key: 'ArrowLeft' });
    expect(handlers.onNext).not.toHaveBeenCalled();
    expect(handlers.onPrevious).not.toHaveBeenCalled();
  });

  it('ignores keys already handled elsewhere and keys raised outside the viewer', () => {
    const handlers = renderHarness();
    const consume = (event: KeyboardEvent) => event.preventDefault();
    window.addEventListener('keydown', consume, true);
    fireEvent.keyDown(screen.getByTestId('viewer'), { key: 'ArrowRight' });
    window.removeEventListener('keydown', consume, true);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(handlers.onNext).not.toHaveBeenCalled();
  });

  it('closes on Escape from the viewer', () => {
    const handlers = renderHarness();
    fireEvent.keyDown(screen.getByTestId('viewer'), { key: 'Escape' });
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('treats form controls as navigation blockers and plain elements as pass-through', () => {
    expect(blocksViewerNavigation(document.createElement('select'))).toBe(true);
    expect(blocksViewerNavigation(document.createElement('textarea'))).toBe(true);
    expect(blocksViewerNavigation(document.createElement('div'))).toBe(false);
    expect(blocksViewerNavigation(null)).toBe(false);
  });
});
