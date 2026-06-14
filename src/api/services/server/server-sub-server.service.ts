/**
 * @file server-sub-server.service.ts
 * @description 子伺服器（server_sub_servers）的資料庫操作層
 * @methods
 *   - getSubServers: 取得某品牌伺服器底下的所有子伺服器，按 position 升冪排序
 *   - getSubServerById: 取得單一子伺服器
 *   - createSubServer: 建立子伺服器
 *   - updateSubServer: 更新子伺服器可編輯欄位
 *   - deleteSubServer: 刪除子伺服器
 *   - getSubServerMedia / getSubServerMediaById / addSubServerMedia / deleteSubServerMedia: 媒體展示區圖片 CRUD
 * @notes
 *   - is_online / player_count 由 heartbeat 或 Server List Ping 餵，不經 CRUD 設定
 *   - 媒體展示區（sub_server_media）依 position 排序，第一張為主圖
 */
import Mysql from "../../utils/mysql";

export type SyncMode = "strict" | "additive";

export interface SubServer {
  id: string;
  server_id: string;
  name: string;
  description: string | null;
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
  description: string | null;
  icon_url: string | null;
  host: string;
  port: number;
  sync_mode: SyncMode;
  position: number;
}

/** 子伺服器媒體展示區的單張圖片 */
export interface SubServerMedia {
  id: string;
  sub_server_id: string;
  url: string;
  position: number;
}

export default class ServerSubServerService {
  /** 取得某品牌伺服器底下的所有子伺服器，依 position 由小到大排序 */
  public async getSubServers(serverId: string): Promise<SubServer[]> {
    const [rows]: any = await Mysql.getPool().query(
      "SELECT id, server_id, name, description, icon_url, host, port, sync_mode, is_online, player_count, position FROM server_sub_servers WHERE server_id = ? ORDER BY position ASC",
      [serverId]
    );
    return (rows as any[]).map(this._mapRow);
  }

  /** 取得單一子伺服器，不存在時回傳 null */
  public async getSubServerById(subServerId: string): Promise<SubServer | null> {
    const [rows]: any = await Mysql.getPool().query(
      "SELECT id, server_id, name, description, icon_url, host, port, sync_mode, is_online, player_count, position FROM server_sub_servers WHERE id = ? LIMIT 1",
      [subServerId]
    );
    return rows.length > 0 ? this._mapRow(rows[0]) : null;
  }

  /** 建立子伺服器，回傳新子伺服器的 id */
  public async createSubServer(serverId: string, input: SubServerInput): Promise<{ id: string }> {
    const id = crypto.randomUUID();
    await Mysql.getPool().query(
      "INSERT INTO server_sub_servers (id, server_id, name, description, icon_url, host, port, sync_mode, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, serverId, input.name, input.description, input.icon_url, input.host, input.port, input.sync_mode, input.position]
    );
    return { id };
  }

  /** 更新子伺服器的可編輯欄位 */
  public async updateSubServer(subServerId: string, input: SubServerInput): Promise<void> {
    await Mysql.getPool().query(
      "UPDATE server_sub_servers SET name = ?, description = ?, icon_url = ?, host = ?, port = ?, sync_mode = ?, position = ? WHERE id = ?",
      [input.name, input.description, input.icon_url, input.host, input.port, input.sync_mode, input.position, subServerId]
    );
  }

  /** 刪除子伺服器 */
  public async deleteSubServer(subServerId: string): Promise<void> {
    await Mysql.getPool().query("DELETE FROM server_sub_servers WHERE id = ?", [subServerId]);
  }

  /** 取得子伺服器媒體展示區的所有圖片，依 position 由小到大排序 */
  public async getSubServerMedia(subServerId: string): Promise<SubServerMedia[]> {
    const [rows]: any = await Mysql.getPool().query(
      "SELECT id, sub_server_id, url, position FROM sub_server_media WHERE sub_server_id = ? ORDER BY position ASC",
      [subServerId]
    );
    return (rows as any[]).map((r) => ({ ...r, position: Number(r.position) }));
  }

  /** 取得單一媒體列，不存在時回傳 null */
  public async getSubServerMediaById(mediaId: string): Promise<SubServerMedia | null> {
    const [rows]: any = await Mysql.getPool().query(
      "SELECT id, sub_server_id, url, position FROM sub_server_media WHERE id = ? LIMIT 1",
      [mediaId]
    );
    return rows.length > 0 ? { ...rows[0], position: Number(rows[0].position) } : null;
  }

  /** 新增一張媒體展示區圖片，position 接續於現有最大值之後 */
  public async addSubServerMedia(subServerId: string, id: string, url: string): Promise<SubServerMedia> {
    const [maxRows]: any = await Mysql.getPool().query(
      "SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM sub_server_media WHERE sub_server_id = ?",
      [subServerId]
    );
    const position = Number(maxRows[0].next_position);
    await Mysql.getPool().query(
      "INSERT INTO sub_server_media (id, sub_server_id, url, position) VALUES (?, ?, ?, ?)",
      [id, subServerId, url, position]
    );
    return { id, sub_server_id: subServerId, url, position };
  }

  /** 刪除一張媒體展示區圖片 */
  public async deleteSubServerMedia(mediaId: string): Promise<void> {
    await Mysql.getPool().query("DELETE FROM sub_server_media WHERE id = ?", [mediaId]);
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
