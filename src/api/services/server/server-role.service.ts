/**
 * @file server-role.service.ts
 * @description 伺服器自訂角色的資料庫操作層
 * @methods
 *   - getRoles: 取得伺服器所有角色，按 position DESC 排序
 *   - getRoleById: 取得單一角色
 *   - createRole: 建立新角色
 *   - updateRole: 更新角色名稱、顏色、權限
 *   - deleteRole: 刪除角色（若有成員持有則拋出 409）
 *   - reorderRoles: 批次更新角色排序
 */
import Mysql from "../../utils/mysql";
import { AppError } from "../../utils/response/AppError";

export interface ServerRole {
  id: string;
  server_id: string;
  name: string;
  color: string;
  permissions: number;
  position: number;
}

export default class ServerRoleService {
  /** 取得指定伺服器的所有角色，依 position 由高到低排序 */
  public async getRoles(serverId: string): Promise<ServerRole[]> {
    const [rows]: any = await Mysql.getPool().query(
      "SELECT id, server_id, name, color, permissions, position FROM server_roles WHERE server_id = ? ORDER BY position DESC",
      [serverId]
    );
    return rows as ServerRole[];
  }

  /** 取得單一角色，不存在時回傳 null */
  public async getRoleById(roleId: string): Promise<ServerRole | null> {
    const [rows]: any = await Mysql.getPool().query(
      "SELECT id, server_id, name, color, permissions, position FROM server_roles WHERE id = ? LIMIT 1",
      [roleId]
    );
    return rows.length > 0 ? (rows[0] as ServerRole) : null;
  }

  /** 建立新角色，回傳新角色的 id */
  public async createRole(
    serverId: string,
    name: string,
    color: string,
    permissions: number
  ): Promise<{ id: string }> {
    const id = crypto.randomUUID();
    await Mysql.getPool().query(
      "INSERT INTO server_roles (id, server_id, name, color, permissions) VALUES (?, ?, ?, ?, ?)",
      [id, serverId, name, color, permissions]
    );
    return { id };
  }

  /** 更新角色的名稱、顏色與權限旗標 */
  public async updateRole(
    roleId: string,
    name: string,
    color: string,
    permissions: number
  ): Promise<void> {
    await Mysql.getPool().query(
      "UPDATE server_roles SET name = ?, color = ?, permissions = ? WHERE id = ?",
      [name, color, permissions, roleId]
    );
  }

  /**
   * 刪除角色。
   * @throws AppError 409 若仍有成員持有此角色
   */
  public async deleteRole(roleId: string): Promise<void> {
    const [memberRows]: any = await Mysql.getPool().query(
      "SELECT 1 FROM server_members WHERE role_id = ? LIMIT 1",
      [roleId]
    );
    if (memberRows.length > 0) {
      throw new AppError("仍有成員持有此角色，無法刪除", 409);
    }
    await Mysql.getPool().query("DELETE FROM server_roles WHERE id = ?", [roleId]);
  }

  /** 依傳入的 id 順序批次更新 position（index 越小 position 越高） */
  public async reorderRoles(serverId: string, orderedIds: string[]): Promise<void> {
    const pool = Mysql.getPool();
    const total = orderedIds.length;
    for (let i = 0; i < total; i++) {
      await pool.query(
        "UPDATE server_roles SET position = ? WHERE id = ? AND server_id = ?",
        [total - i, orderedIds[i], serverId]
      );
    }
  }
}
