import type { MessageServerRole } from '../models/MessageServer.js';

export function canManageMessageServer(role: MessageServerRole | undefined) { return role === 'owner' || role === 'admin'; }
export function canAccessMessageServer(serverTenantId: string, activeTenantId: string, memberAccountId: string | undefined, accountId: string) {
  return serverTenantId === activeTenantId && memberAccountId === accountId;
}
export function validMessageServerName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 2 && value.trim().length <= 60;
}
export function validMessageServerTag(value: unknown) { return typeof value === 'string' && (value === '' || /^[A-Z0-9]{2,4}$/.test(value)); }
export function validMessageServerColor(value: unknown): value is string { return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value); }
export function canManageMessageServerHierarchy(actorRole: MessageServerRole, actorTop: number, targetRole: MessageServerRole, targetTop: number, selfTarget = false) {
  if (selfTarget || targetRole === 'owner') return false;
  if (actorRole === 'owner') return true;
  if (targetRole === 'admin') return false;
  return Math.max(actorRole === 'admin' ? MESSAGE_SERVER_LEGACY_ADMIN_POSITION : 0, actorTop) > targetTop;
}

export type OrderedCustomRole = { id: string; position: number };
export const MESSAGE_SERVER_LEGACY_ADMIN_POSITION = 1_000_000_000;

export function messageServerTopRolePosition(role: MessageServerRole, positions: number[]) {
  if (role === 'owner') return Number.MAX_SAFE_INTEGER;
  return Math.max(role === 'admin' ? MESSAGE_SERVER_LEGACY_ADMIN_POSITION : 0, ...positions);
}

export function canManageMessageServerCustomRole(actorRole: MessageServerRole, actorTop: number, targetPosition: number) {
  return actorRole === 'owner' || Math.max(actorRole === 'admin' ? MESSAGE_SERVER_LEGACY_ADMIN_POSITION : 0, actorTop) > targetPosition;
}

export function canAccessMessageServerPrivateChannel(role: MessageServerRole, memberRoleIds: string[], allowedRoleIds: string[], hasGlobalPrivateAccess = false) {
  return role === 'owner' || role === 'admin' || hasGlobalPrivateAccess || allowedRoleIds.some((id) => memberRoleIds.includes(id));
}

export function canGrantMessageServerPermissions(role: MessageServerRole, actorPermissions: string[], requestedPermissions: string[]) {
  return role === 'owner' || role === 'admin' || requestedPermissions.every((permission) => actorPermissions.includes(permission));
}

export function canReorderMessageServerRoles(actorRole: MessageServerRole, actorTop: number, currentRoles: OrderedCustomRole[], orderedRoleIds: string[]) {
  if (currentRoles.length !== orderedRoleIds.length || new Set(orderedRoleIds).size !== currentRoles.length) return false;
  const byId = new Map(currentRoles.map((role) => [role.id, role]));
  if (orderedRoleIds.some((id) => !byId.has(id))) return false;
  if (actorRole === 'owner') return true;
  return currentRoles.every((role, index) => role.position < actorTop
    ? (byId.get(orderedRoleIds[index])?.position ?? actorTop) < actorTop
    : orderedRoleIds[index] === role.id);
}

export function reorderedMessageServerRolePositions(actorRole: MessageServerRole, actorTop: number, currentRoles: OrderedCustomRole[], orderedRoleIds: string[]) {
  if (!canReorderMessageServerRoles(actorRole, actorTop, currentRoles, orderedRoleIds)) return null;
  const byId = new Map(currentRoles.map((role) => [role.id, role]));
  if (actorRole === 'owner') return new Map(orderedRoleIds.map((id, index) => [id, orderedRoleIds.length - index]));
  const availablePositions = currentRoles.filter((role) => role.position < actorTop).map((role) => role.position).sort((a, b) => b - a);
  const mutableIds = orderedRoleIds.filter((id) => (byId.get(id)?.position ?? actorTop) < actorTop);
  const positions = new Map(currentRoles.filter((role) => role.position >= actorTop).map((role) => [role.id, role.position]));
  mutableIds.forEach((id, index) => positions.set(id, availablePositions[index]));
  return positions;
}
