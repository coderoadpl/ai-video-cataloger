export type AspectRatioIndicatorKind = 'portrait' | 'panorama';

const PANORAMA_RATIO_THRESHOLD = 2.4;

export const aspectRatioIndicatorKind = (
  width: number | null,
  height: number | null,
): AspectRatioIndicatorKind | null => {
  if (width === null || height === null || width <= 0 || height <= 0) return null;
  if (height > width) return 'portrait';
  if (width / height >= PANORAMA_RATIO_THRESHOLD) return 'panorama';
  return null;
};
