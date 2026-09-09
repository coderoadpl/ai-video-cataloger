export interface PairReviewBadge {
  count: number;
  truncated: boolean;
}

export const pairReviewBadge = (pending: number, limit: number): PairReviewBadge => ({
  count: Math.min(pending, limit),
  truncated: pending > limit,
});
