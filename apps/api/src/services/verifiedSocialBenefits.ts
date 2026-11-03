export const VERIFIED_FEED_BOOST = 0.03;
export const VERIFIED_TREND_BOOST = 0.04;
export const VERIFIED_EXPLORE_BOOST = 0.04;
export const VERIFIED_MATCH_BOOST = 0.02;

type VerificationState = { status?: string; type?: string; verifiedAt?: Date; expiresAt?: Date | null; removedAt?: Date } | null | undefined;
type RankablePost = { likesCount?: number; commentsCount?: number; createdAt: Date };

export function isVerificationActive(verification: VerificationState, now = new Date()) {
  const status = verification?.status?.toUpperCase();
  const legacyActive = !status && Boolean(verification?.verifiedAt);
  return (status === 'ACTIVE' || status === 'APPROVED' || legacyActive)
    && (!verification?.expiresAt || verification.expiresAt > now)
    && !verification?.removedAt;
}

export function socialDistributionScore(post: RankablePost, verified: boolean, surface: 'feed' | 'trend' | 'explore') {
  const ageHours = Math.max(0, (Date.now() - post.createdAt.getTime()) / 3_600_000);
  const relevance = (post.likesCount ?? 0) + (post.commentsCount ?? 0) * 1.5;
  const recency = 10 / (1 + ageHours / 8);
  const base = relevance + recency;
  const boost = surface === 'feed' ? VERIFIED_FEED_BOOST : surface === 'trend' ? VERIFIED_TREND_BOOST : VERIFIED_EXPLORE_BOOST;
  return base * (verified ? 1 + boost : 1);
}
