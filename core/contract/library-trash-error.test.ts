import { describe, expect, it } from 'vitest';

import { libraryTrashSummaryOfDetails } from './library-trash-error.js';

const summary = {
  kind: 'library_trash',
  filesTrashed: 1,
  videosTrashed: 1,
  photosTrashed: 0,
  filesFailed: 1,
  filesNotAttempted: 2,
  failedFingerprint: 'fp-failed',
  cancelled: false,
  analysesDeleted: 1,
  observationsDeleted: 0,
  peopleDeleted: 0,
  artifactPathsDeleted: 3,
  snapshotsRewritten: 1,
  roots: ['/library/videos'],
} as const;

describe('libraryTrashSummaryOfDetails', () => {
  it('reads the partial summary an incomplete trash error carries alongside its cause', () => {
    expect(libraryTrashSummaryOfDetails({ cause: { code: 'delete_error', message: 'refused' }, summary }))
      .toMatchObject({ filesTrashed: 1, filesFailed: 1, filesNotAttempted: 2 });
  });

  it('returns null for details without a trash summary', () => {
    expect(libraryTrashSummaryOfDetails({ roots: ['/library/videos'] })).toBeNull();
    expect(libraryTrashSummaryOfDetails(undefined)).toBeNull();
  });
});
