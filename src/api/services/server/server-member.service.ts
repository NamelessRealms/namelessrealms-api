/**
 * @file server-member.service.ts
 * @description 伺服器成員的資料庫操作層（Discord 風格 role_id 架構）
 * @methods
 *   - getMemberWithRole: 取得成員及其完整角色資料（含 permissions）
 *   - getMembers: 取得所有成員（含 username、role info）
 *   - getUserIdByUsername: 由 username 查 users.unique
 *   - addMemberByUsername: 以 username 邀請成員並指定角色
 *   - updateMemberRole: 更新成員角色
 *   - removeMember: 移除成員
 */
import Mysql from "../../utils/mysql";

export interface MemberRole {
  id: string;
  name: string;
  color: string;
  permissions: number;
  position: number;
}

export interface ServerMemberWithRole {
  user_id: string;
  username: string;
  role: MemberRole;
  joined_at: Date;
}

export default class ServerMemberService {
  /**
   * 取得指定成員及其角色資料（含 permissions bitmask）。
   * @returns 成員+角色物件，不存在時回傳 null
   */
  public async getMemberWithRole(
    serverId: string,
    userId: string
  ): Promise<ServerMemberWithRole | null> {
    const [rows]: any = await Mysql.getPool().query(
      `SELECT sm.user_id, u.username, sm.joined_at,
              sr.id AS role_id, sr.name AS role_name, sr.color, sr.permissions, sr.position
       FROM server_members sm
       JOIN users u ON u.\`unique\` = sm.user_id
       JOIN server_roles sr ON sr.id = sm.role_id
       WHERE sm.server_id = ? AND sm.user_id = ?
       LIMIT 1`,
      [serverId, userId]
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      user_id: r.user_id,
      username: r.username,
      joined_at: r.joined_at,
      role: {
        id: r.role_id,
        name: r.role_name,
        color: r.color,
        permissions: r.permissions,
        position: r.position,
      },
    };
  }

  /** 取得伺服器所有成員列表（含 username 與完整角色資訊） */
  public async getMembers(serverId: string): Promise<ServerMemberWithRole[]> {
    const [rows]: any = await Mysql.getPool().query(
      `SELECT sm.user_id, u.username, sm.joined_at,
              sr.id AS role_id, sr.name AS role_name, sr.color, sr.permissions, sr.position
       FROM server_members sm
       JOIN users u ON u.\`unique\` = sm.user_id
       JOIN server_roles sr ON sr.id = sm.role_id
       WHERE sm.server_id = ?
       ORDER BY sm.joined_at ASC`,
      [serverId]
    );
    return rows.map((r: any) => ({
      user_id: r.user_id,
      username: r.username,
      joined_at: r.joined_at,
      role: {
        id: r.role_id,
        name: r.role_name,
        color: r.color,
        permissions: r.permissions,
        position: r.position,
      },
    }));
  }

  /**
   * 以 username 查找對應的 user_id（users.unique）。
   * @returns user_id，username 不存在則回傳 null
   */
  public async getUserIdByUsername(username: string): Promise<string | null> {
    const [rows]: any = await Mysql.getPool().query(
      "SELECT `unique` FROM users WHERE username = ? LIMIT 1",
      [username]
    );
    return rows.length > 0 ? rows[0].unique : null;
  }

  /**
   * 以 username 邀請成員並指定角色 id。
   * @returns 新成員的 user_id，username 不存在則回傳 null
   */
  public async addMemberByUsername(
    serverId: string,
    username: string,
    roleId: string
  ): Promise<string | null> {
    const [userRows]: any = await Mysql.getPool().query(
      "SELECT `unique` FROM users WHERE username = ? LIMIT 1",
      [username]
    );
    if (userRows.length === 0) return null;
    const userId: string = userRows[0].unique;
    await Mysql.getPool().query(
      "INSERT INTO server_members (server_id, user_id, role_id) VALUES (?, ?, ?)",
      [serverId, userId, roleId]
    );
    return userId;
  }

  /** 更新指定成員的角色 */
  public async updateMemberRole(serverId: string, userId: string, roleId: string): Promise<void> {
    await Mysql.getPool().query(
      "UPDATE server_members SET role_id = ? WHERE server_id = ? AND user_id = ?",
      [roleId, serverId, userId]
    );
  }

  /** 從伺服器中移除指定成員 */
  public async removeMember(serverId: string, userId: string): Promise<void> {
    await Mysql.getPool().query(
      "DELETE FROM server_members WHERE server_id = ? AND user_id = ?",
      [serverId, userId]
    );
  }
}
