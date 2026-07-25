import { displayAspectRatio, type SourceAspectInput } from './thumbnail-aspect.js';

export interface PlayerBox {
  aspectRatio: number;
  maxWidthPx: number | null;
  maxHeightPx: number;
}

export const playerBoxForSource = (
  source: SourceAspectInput | undefined,
  maxHeightPx: number,
): PlayerBox => {
  const aspectRatio = displayAspectRatio(source);
  const maxWidthPx = aspectRatio < 1 ? Math.round(maxHeightPx * aspectRatio) : null;
  return { aspectRatio, maxWidthPx, maxHeightPx };
};
