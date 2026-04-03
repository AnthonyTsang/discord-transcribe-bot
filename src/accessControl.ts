import db from "./db.js";

const stmtAddRole    = db.prepare(`INSERT OR IGNORE INTO access_control (type, id) VALUES ('role', ?)`);
const stmtRemoveRole = db.prepare(`DELETE FROM access_control WHERE type = 'role' AND id = ?`);
const stmtListRoles  = db.prepare<{ id: string }, []>(
  `SELECT id FROM access_control WHERE type = 'role' ORDER BY id`
);

const stmtAddUser    = db.prepare(`INSERT OR IGNORE INTO access_control (type, id) VALUES ('user', ?)`);
const stmtRemoveUser = db.prepare(`DELETE FROM access_control WHERE type = 'user' AND id = ?`);
const stmtListUsers  = db.prepare<{ id: string }, []>(
  `SELECT id FROM access_control WHERE type = 'user' ORDER BY id`
);

export function addAllowedRole(roleId: string): boolean {
  return stmtAddRole.run(roleId).changes > 0;
}

export function removeAllowedRole(roleId: string): boolean {
  return stmtRemoveRole.run(roleId).changes > 0;
}

export function getAllowedRoles(): string[] {
  return stmtListRoles.all().map((r) => r.id);
}

export function addAllowedUser(userId: string): boolean {
  return stmtAddUser.run(userId).changes > 0;
}

export function removeAllowedUser(userId: string): boolean {
  return stmtRemoveUser.run(userId).changes > 0;
}

export function getAllowedUsers(): string[] {
  return stmtListUsers.all().map((r) => r.id);
}

/**
 * Returns true if the user is permitted to use the bot.
 *
 * Rules:
 *  - If both lists are empty → open access (everyone allowed).
 *  - Otherwise the user must appear in the user list OR hold a role in the role list.
 */
export function canUseBot(userId: string, memberRoleIds: readonly string[]): boolean {
  const allowedUsers = getAllowedUsers();
  const allowedRoles = getAllowedRoles();

  if (allowedUsers.length === 0 && allowedRoles.length === 0) return true;
  if (allowedUsers.includes(userId)) return true;
  return memberRoleIds.some((id) => allowedRoles.includes(id));
}
