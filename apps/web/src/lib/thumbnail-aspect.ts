export interface SourceAspectInput {
  width?: number | null | undefined;
  height?: number | null | undefined;
  rotation?: number | null | undefined;
}

export interface ThumbnailBox {
  width: number;
  height: number;
}

export const thumbnailBoxForSource = (
  source: SourceAspectInput | undefined,
  baseWidth: number,
): ThumbnailBox => {
  const aspect = displayAspectRatio(source);
  const unclampedHeight = baseWidth / aspect;
  return {
    width: baseWidth,
    height: Math.round(Math.min(baseWidth, Math.max(baseWidth * 0.45, unclampedHeight))),
  };
};

export const displayAspectRatio = (source: SourceAspectInput | undefined): number => {
  const width = source?.width ?? null;
  const height = source?.height ?? null;
  if (width === null || height === null || width <= 0 || height <= 0) return 16 / 9;
  const rotated = isQuarterTurn(source?.rotation ?? null);
  const displayWidth = rotated ? height : width;
  const displayHeight = rotated ? width : height;
  return displayWidth / displayHeight;
};

const isQuarterTurn = (rotation: number | null): boolean => {
  if (rotation === null || !Number.isFinite(rotation)) return false;
  const normalized = ((rotation % 360) + 360) % 360;
  return normalized === 90 || normalized === 270;
};
