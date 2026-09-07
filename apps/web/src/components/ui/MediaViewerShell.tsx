import { useId, useRef, type ReactNode } from 'react';
import { Box, IconButton, Modal, Typography } from '@mui/material';

import { ArrowBackIcon, CancelIcon, SkipNextIcon } from './icons.js';
import { useViewerKeys } from './use-viewer-keys.js';

interface MediaViewerShellProps {
  testId: string;
  title: string;
  caption: string;
  onClose: () => void;
  closeLabel: string;
  closeTestId: string;
  previousLabel: string;
  nextLabel: string;
  previousTestId: string;
  nextTestId: string;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
  stage: ReactNode;
  headerAction?: ReactNode;
  side?: ReactNode;
  captionTestId?: string;
  surfaceProps?: Record<string, string>;
}

export const MediaViewerShell = ({
  testId,
  title,
  caption,
  onClose,
  closeLabel,
  closeTestId,
  previousLabel,
  nextLabel,
  previousTestId,
  nextTestId,
  onPrevious,
  onNext,
  stage,
  headerAction,
  side,
  captionTestId,
  surfaceProps,
}: MediaViewerShellProps) => {
  const titleId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  useViewerKeys({ containerRef, onClose, onPrevious, onNext });

  return (
    <Modal open onClose={onClose} data-testid={`${testId}-modal`}>
      <Box
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        {...surfaceProps}
        sx={{
          position: 'absolute',
          top: '5%',
          left: '5%',
          right: '5%',
          bottom: '5%',
          bgcolor: 'background.paper',
          display: 'flex',
          flexDirection: 'column',
          outline: 'none',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1 }}>
          {headerAction}
          <Typography id={titleId} variant="h2" noWrap title={title} sx={{ flex: 1, minWidth: 0 }}>
            {title}
          </Typography>
          <IconButton aria-label={closeLabel} onClick={onClose} data-testid={closeTestId}>
            <CancelIcon />
          </IconButton>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', p: 2 }}>
            {onPrevious === null ? null : (
              <IconButton
                aria-label={previousLabel}
                onClick={onPrevious}
                data-testid={previousTestId}
                sx={{ position: 'absolute', left: 8 }}
              >
                <ArrowBackIcon />
              </IconButton>
            )}
            {stage}
            {onNext === null ? null : (
              <IconButton
                aria-label={nextLabel}
                onClick={onNext}
                data-testid={nextTestId}
                sx={{ position: 'absolute', right: 8 }}
              >
                <SkipNextIcon />
              </IconButton>
            )}
          </Box>
          {side}
        </Box>
        <Box sx={{ p: 1, textAlign: 'center' }}>
          <Typography variant="body2" data-testid={captionTestId}>{caption}</Typography>
        </Box>
      </Box>
    </Modal>
  );
};
