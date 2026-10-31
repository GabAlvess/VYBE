export type EventCreationPolicy = 'any_pending' | 'staff' | 'admins' | 'owner';
export type EventCreationDecision = 'denied' | 'pending_approval' | 'approved';

export function eventCreationDecision(policy: EventCreationPolicy, isOwner: boolean, isAdmin: boolean, isModerator: boolean): EventCreationDecision {
  const allowed = policy === 'any_pending' || (policy === 'staff' && (isOwner || isAdmin || isModerator)) || (policy === 'admins' && (isOwner || isAdmin)) || (policy === 'owner' && isOwner);
  if (!allowed) return 'denied';
  return isOwner || isAdmin ? 'approved' : 'pending_approval';
}

export function canReviewEvents(isOwner: boolean, isAdmin: boolean) { return isOwner || isAdmin; }
export function canSeeEvent(status: string, isStaff: boolean, isCreator: boolean) { return status === 'approved' || status === 'upcoming' || isStaff || isCreator; }
export function canJoinEvent(currentCount: number, limit: number | null, alreadyGoing: boolean) { return alreadyGoing || limit === null || currentCount < limit; }
