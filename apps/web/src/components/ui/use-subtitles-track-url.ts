import { useEffect, useState } from 'react';

import { buildWebVtt, type TranscriptSegment } from '../../lib/subtitles.js';

export const useSubtitlesTrackUrl = (segments: readonly TranscriptSegment[] | null | undefined): string | null => {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const vtt = buildWebVtt(segments ?? []);
    if (vtt === null) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [segments]);

  return url;
};
