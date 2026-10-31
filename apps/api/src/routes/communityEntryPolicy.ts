export type CommunityEntrySettings = {
  entry?: 'open' | 'approval';
  settings?: { access?: { visibility?: 'public' | 'private' | 'controlled'; approvalRequired?: boolean } };
};

export function requiresJoinApproval(community: CommunityEntrySettings) {
  const access = community.settings?.access;
  return community.entry === 'approval' || access?.approvalRequired === true || (access?.visibility !== undefined && access.visibility !== 'public');
}
