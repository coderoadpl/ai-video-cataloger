export type FormatLocale = 'en' | 'pl';

const INTL_LOCALE_TAG: Record<FormatLocale, string> = { en: 'en-GB', pl: 'pl-PL' };

export const folderName = (path: string): string => {
  const trimmed = path.replace(/\/+$/, '');
  const slash = trimmed.lastIndexOf('/');
  return slash === -1 ? trimmed : trimmed.slice(slash + 1);
};

export const versionLabel = (version: string): string =>
  version.length === 0 ? '' : `v${version}`;

export const formatCoordinates = (lat: number, lon: number): string =>
  `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;

export const formatCapturedAt = (iso: string | null, locale: FormatLocale): string | null =>
  iso === null
    ? null
    : new Intl.DateTimeFormat(INTL_LOCALE_TAG[locale], { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

export const formatDate = (epochMs: number, locale: FormatLocale): string =>
  new Intl.DateTimeFormat(INTL_LOCALE_TAG[locale], { dateStyle: 'medium' }).format(new Date(epochMs));
