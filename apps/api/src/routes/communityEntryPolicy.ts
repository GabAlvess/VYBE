export type CommunityEntrySettings = {
  entry?: 'open' | 'approval';
  settings?: { access?: { visibility?: 'public' | 'private' | 'controlled'; approvalRequired?: boolean } };
};

export function requiresJoinApproval(community: CommunityEntrySettings) {
  const access = community.settings?.access;
  if (access?.visibility === 'public') return false;
  return community.entry === 'approval' || access?.approvalRequired === true || access?.visibility === 'controlled' || access?.visibility === 'private';
}
