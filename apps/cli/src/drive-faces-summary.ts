import { driveRunFacesSchema } from '@core/contract/index.js';

export const driveFacesSummaryLine = (value: unknown): string | null => {
  const parsed = driveRunFacesSchema.safeParse(value);
  if (!parsed.success) return null;
  const faces = parsed.data;
  if (faces.ran) {
    const failedSuffix = faces.filesFailed > 0
      ? `, ${String(faces.filesFailed)} file(s) failed (${faces.failureCodes.map((entry) => `${entry.code}×${String(entry.count)}`).join(', ')})`
      : '';
    const abortedSuffix = faces.aborted
      ? ' — faces pass aborted after 5 consecutive failures; re-run "ai-video-cataloger faces index <root>"'
      : '';
    const rejectedSuffix = faces.rejectedLowQuality > 0
      ? `, ${String(faces.rejectedLowQuality)} low-quality detection(s) rejected`
      : '';
    return `faces: indexed ${String(faces.filesIndexed)} file(s), ${String(faces.observationsAdded)} observation(s), `
      + `${String(faces.peopleCreated)} new person(s)${rejectedSuffix}${failedSuffix}${abortedSuffix}`;
  }
  switch (faces.skippedReason) {
    case 'flag':
      return 'faces: NOT indexed (--skip-faces) — run "ai-video-cataloger faces index <root>" to build them';
    case 'artifacts_missing':
      return 'faces: NOT indexed (face models are not installed) — run "ai-video-cataloger models faces install", '
        + 'then "ai-video-cataloger faces index <root>"';
    case 'unavailable':
      return 'faces: NOT indexed (the face engine is unavailable in this build)';
    case 'cancelled':
      return 'faces: NOT indexed (run cancelled) — re-run the same root to finish';
    case 'failed':
      return `faces: NOT indexed (${faces.error?.message ?? 'the faces pass failed'}) — `
        + 'run "ai-video-cataloger faces index <root>"';
    case null:
      return null;
  }
};
