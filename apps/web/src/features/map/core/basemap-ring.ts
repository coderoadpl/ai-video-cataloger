export type BasemapRing = readonly (readonly number[])[];

export const unwrapRing = (ring: BasemapRing): number[][] => {
  const unwrapped: number[][] = [];
  let offset = 0;
  for (const [index, point] of ring.entries()) {
    const lon = point[0] ?? 0;
    const lat = point[1] ?? 0;
    const previous = unwrapped[index - 1];
    if (previous !== undefined) {
      const step = lon + offset - (previous[0] ?? 0);
      if (step > 180) offset -= 360;
      else if (step < -180) offset += 360;
    }
    unwrapped.push([lon + offset, lat]);
  }
  return unwrapped;
};
