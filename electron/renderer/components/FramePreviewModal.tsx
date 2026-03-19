/**
 * Frame Preview Modal Component
 * Displays extracted frames in a larger view with navigation
 */
import React, { useEffect, useCallback } from 'react';
import '../styles/FramePreviewModal.css';

interface FramePreviewModalProps {
  frames: string[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

function FramePreviewModal({
  frames,
  currentIndex,
  onClose,
  onNavigate,
}: FramePreviewModalProps): React.ReactElement {
  const totalFrames = frames.length;
  const currentFrame = frames[currentIndex];

  const goToPrevious = useCallback(() => {
    if (currentIndex > 0) {
      onNavigate(currentIndex - 1);
    }
  }, [currentIndex, onNavigate]);

  const goToNext = useCallback(() => {
    if (currentIndex < totalFrames - 1) {
      onNavigate(currentIndex + 1);
    }
  }, [currentIndex, totalFrames, onNavigate]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowLeft':
          goToPrevious();
          break;
        case 'ArrowRight':
          goToNext();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, goToPrevious, goToNext]);

  // Handle click outside to close
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="frame-modal-overlay" onClick={handleOverlayClick}>
      <div className="frame-modal">
        <div className="frame-modal-header">
          <span className="frame-indicator">
            Frame {currentIndex + 1} of {totalFrames}
          </span>
          <button className="close-button" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>

        <div className="frame-modal-content">
          <button
            className="nav-button prev"
            onClick={goToPrevious}
            disabled={currentIndex === 0}
            title="Previous frame (←)"
          >
            ‹
          </button>

          <div className="frame-container">
            <img src={`file://${currentFrame}`} alt={`Frame ${currentIndex + 1}`} />
          </div>

          <button
            className="nav-button next"
            onClick={goToNext}
            disabled={currentIndex === totalFrames - 1}
            title="Next frame (→)"
          >
            ›
          </button>
        </div>

        <div className="frame-modal-footer">
          <div className="frame-thumbnails">
            {frames.map((frame, index) => (
              <button
                key={index}
                className={`thumbnail-button ${index === currentIndex ? 'active' : ''}`}
                onClick={() => onNavigate(index)}
                title={`Frame ${index + 1}`}
              >
                <img src={`file://${frame}`} alt={`Thumbnail ${index + 1}`} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default FramePreviewModal;
