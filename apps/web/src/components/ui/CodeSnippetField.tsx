import { useEffect, useState } from 'react';
import { Box, IconButton } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { CheckCircleIcon, ContentCopyIcon } from './icons.js';

const COPIED_FEEDBACK_MS = 2000;

export const CodeSnippetField = ({ value, testId }: { value: string; testId: string }) => {
  const dictionary = useDictionary();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
      <Box
        component="code"
        title={value}
        data-testid={testId}
        sx={{
          flex: 1,
          // `minWidth: 0` only lifts the shrink floor; the explicit zero width is what keeps the
          // nowrap text out of the section's min-content width, which would otherwise widen the
          // whole details column past its pane.
          width: 0,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          bgcolor: 'action.hover',
          px: 0.75,
          py: 0.5,
          borderRadius: 0.5,
          fontSize: '0.75rem',
        }}
      >
        {value}
      </Box>
      <IconButton
        size="small"
        data-testid={`${testId}-copy`}
        aria-label={copied ? dictionary.common.copied : dictionary.common.copyToClipboard}
        title={copied ? dictionary.common.copied : dictionary.common.copyToClipboard}
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          setCopied(true);
        }}
      >
        {copied
          ? <CheckCircleIcon fontSize="small" sx={{ color: 'status.completed.main' }} />
          : <ContentCopyIcon fontSize="small" />}
      </IconButton>
    </Box>
  );
};
