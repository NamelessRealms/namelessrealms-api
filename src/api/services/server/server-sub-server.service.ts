/**
 * @file server-sub-server.service.ts
 * @description 子伺服器（server_sub_servers）的資料庫操作層
 * @methods
 *   - getSubServers: 取得某品牌伺服器底下的所有子伺服器，按 position 升冪排序
 *   - getSubServerById: 取得單一子伺服器
 *   - createSubServer: 建立子伺服器
 *   - updateSubServer: 更新子伺服器可編輯欄位
 *   - deleteSubServer: 刪除子伺服器
 * @notes
 *   - is_online / player_count 由 heartbeat 或 Server List Ping 餵，不經 CRUD 設定
 */
import Mysql from "../../utils/mysql";

export type SyncMode = "strict" | "additive";

export interface SubServer {
  id: string;
  server_id: string;
  name: string;
  icon_url: string | null;
  host: string;
  port: number;
  sync_mode: SyncMode;
  is_online: boolean;
  player_count: number;
  position: number;
}

/** 建立 / 更新子伺服器時可由呼叫端設定的欄位 */
export interface SubServerInput {
  name: string;
  icon_url: string | null;
  host: string;
  port: number;
  sync_mode: SyncMode;
  position: number;
}

export default class ServerSubServerService {
  /** 取得某品牌伺服器底下的所有子伺服器，依 position 由小到大排序 */
  public async getSubServers(serverId: string): Promise<SubServer[]> {
    const [rows]: any = await Mysql.getPool().query(
      "SELECT id, server_id, name, icon_url, host, port, sync_mode, is_online, player_count, position FROM server_sub_servers WHERE server_id = ? ORDER BY position ASC",
      [serverId]
    );
    return (rows as any[]).map(this._mapRow);
  }

  /** 取得單一子伺服器，不存在時回傳 null */
  public async getSubServerById(subServerId: string): Promise<SubServer | null> {
    const [rows]: any = await Mysql.getPool().query(
      "SELECT id, server_id, name, icon_url, host, port, sync_mode, is_online, player_count, position FROM server_sub_servers WHERE id = ? LIMIT 1",
      [subServerId]
    );
    return rows.length > 0 ? this._mapRow(rows[0]) : null;
  }

  /** 建立子伺服器，回傳新子伺服器的 id */
  public async createSubServer(serverId: string, input: SubServerInput): Promise<{ id: string }> {
    const id = crypto.randomUUID();
    await Mysql.getPool().query(
      "INSERT INTO server_sub_servers (id, server_id, name, icon_url, host, port, sync_mode, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, serverId, input.name, input.icon_url, input.host, input.port, input.sync_mode, input.position]
    );
    return { id };
  }

  /** 更新子伺服器的可編輯欄位 */
  public async updateSubServer(subServerId: string, input: SubServerInput): Promise<void> {
    await Mysql.getPool().query(
      "UPDATE server_sub_servers SET name = ?, icon_url = ?, host = ?, port = ?, sync_mode = ?, position = ? WHERE id = ?",
      [input.name, input.icon_url, input.host, input.port, input.sync_mode, input.position, subServerId]
    );
  }

  /** 刪除子伺服器 */
  public async deleteSubServer(subServerId: string): Promise<void> {
    await Mysql.getPool().query("DELETE FROM server_sub_servers WHERE id = ?", [subServerId]);
  }

  /** 將資料庫列正規化為 SubServer（TINYINT → boolean、數值欄位轉 number） */
  private _mapRow(row: any): SubServer {
    return {
      ...row,
      port: Number(row.port),
      is_online: row.is_online === 1,
      player_count: Number(row.player_count),
      position: Number(row.position),
    };
  }
}
