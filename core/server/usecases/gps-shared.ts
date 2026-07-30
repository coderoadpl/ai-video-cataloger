export const accuracyBucketsM = [200, 500, 1000, 5000, 20_000, null] as const;

export const percentile = (sorted: readonly number[], fraction: number): number => {
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index] ?? 0;
};
