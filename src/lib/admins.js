import { normalizeUsername } from './utils.js';

const SUPER_ADMIN_USERNAMES = new Set(['o_legacy']);

export function isSuperAdminUsername(username) {
  return SUPER_ADMIN_USERNAMES.has(normalizeUsername(username));
}

export function isSuperAdminPlayer(player) {
  return isSuperAdminUsername(player?.username);
}
