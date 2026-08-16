import type { PhotoListItem } from './photo-list-item.js';

export type PhotoBadge = 'analysed' | 'analysisFailed' | 'duplicate' | 'proxyFailed' | 'exifMissing' | 'missing';

export type PhotoBadgeInput = Pick<PhotoListItem, 'analysed' | 'analysisError' | 'sightings' | 'proxyState' | 'exifReadAt' | 'missingAt'>;

export const photoBadges = (item: PhotoBadgeInput): PhotoBadge[] => {
  const badges: PhotoBadge[] = [];
  if (item.analysed) badges.push('analysed');
  if (item.analysisError !== null) badges.push('analysisFailed');
  if (item.sightings > 1) badges.push('duplicate');
  if (item.proxyState === 'failed') badges.push('proxyFailed');
  if (item.exifReadAt === null) badges.push('exifMissing');
  if (item.missingAt !== null) badges.push('missing');
  return badges;
};
