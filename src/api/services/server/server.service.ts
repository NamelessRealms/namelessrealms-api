/**
 * @file server.service.ts
 * @description 社群伺服器的資料庫操作層，含名稱衝突檢查、CRUD 與媒體 URL upsert
 * @methods
 *   - isNameTaken / isNameTakenByOther: 檢查伺服器名稱是否已被使用
 *   - createServer: 新增伺服器紀錄（同時建立同名預設子伺服器）
 *   - getServerCards / getServerById: 查詢玩家瀏覽卡片（每子伺服器一張）與品牌單筆資料
 *   - updateServer: 更新伺服器基本資訊
 *   - upsertServerMedia: 以 ON DUPLICATE KEY UPDATE 更新 icon 或 background URL
 * @dependencies mysql2
 * @notes tags 欄位以 JSON 字串儲存於資料庫，讀取時自動反序列化
 */
import Mysql from "../../utils/mysql";
import { Permission } from "../../utils/permissions";

export interface ServerSettings {
  id: string;
  owner_user_id: string;
  name: string;
  description: string;
  tags: string[];
  icon_url: string | null;
  background_url: string | null;
}

/**
 * 玩家瀏覽用的卡片：一個子伺服器一張，攜帶所屬品牌的識別資料（logo/背景/標籤）。
 * 名稱與描述取自子伺服器；點進去後以 server_id + sub_server_id 進入詳情。
 */
export interface ServerCard {
  server_id: string;
  owner_user_id: string;
  server_name: string;
  sub_server_id: string;
  name: string;
  description: string;
  tags: string[];
  icon_url: string | null;
  background_url: string | null;
  is_online: boolean;
  player_count: number;
  position: number;
}

export default class ServerService {
  public async isNameTaken(name: string): Promise<boolean> {
    const [rows]: any = await Mysql.getPool().query(
      "SELECT id FROM servers WHERE name = ? LIMIT 1",
      [name]
    );
    return rows.length > 0;
  }

  public async isNameTakenByOther(name: string, excludeId: string): Promise<boolean> {
    const [rows]: any = await Mysql.getPool().query(
      "SELECT id FROM servers WHERE name = ? AND id != ? LIMIT 1",
      [name, excludeId]
    );
    return rows.length > 0;
  }

  public async createServer(
    name: string,
    description: string,
    tags: string[],
    ownerUserId: string
  ): Promise<{ id: string }> {
    const id = crypto.randomUUID();
    const roleId = crypto.randomUUID();
    const subServerId = crypto.randomUUID();
    const pool = Mysql.getPool();
    await pool.query(
      "INSERT INTO servers (id, name, description, tags, owner_user_id) VALUES (?, ?, ?, ?, ?)",
      [id, name, description, JSON.stringify(tags), ownerUserId]
    );
    await pool.query(
      "INSERT INTO server_roles (id, server_id, name, color, permissions, position) VALUES (?, ?, '管理員', '#99aab5', ?, 1)",
      [roleId, id, Permission.ADMINISTRATOR]
    );
    await pool.query(
      "INSERT INTO server_members (server_id, user_id, role_id) VALUES (?, ?, ?)",
      [id, ownerUserId, roleId]
    );
    // 建立同名預設子伺服器：單一伺服器的服主毋須意識到「子伺服器」概念，host 留空待連線設定補
    await pool.query(
      "INSERT INTO server_sub_servers (id, server_id, name, host, position) VALUES (?, ?, ?, '', 0)",
      [subServerId, id, name]
    );
    return { id };
  }

  /**
   * 取得玩家瀏覽用的卡片列表：每個子伺服器一張卡，攜帶所屬品牌的 logo/背景/標籤。
   * 媒體以相關子查詢取得，避免與子伺服器 JOIN 造成列數相乘。
   */
  public async getServerCards(): Promise<ServerCard[]> {
    const [rows]: any = await Mysql.getPool().query(
      `SELECT
        s.id AS server_id, s.owner_user_id, s.name AS server_name, s.tags,
        ss.id AS sub_server_id, ss.name AS sub_name, ss.description AS sub_description,
        ss.is_online, ss.player_count, ss.position,
        (SELECT url FROM server_media WHERE server_id = s.id AND media_type = 'icon' LIMIT 1) AS icon_url,
        (SELECT url FROM server_media WHERE server_id = s.id AND media_type = 'background' LIMIT 1) AS background_url
      FROM servers s
      JOIN server_sub_servers ss ON ss.server_id = s.id
      ORDER BY s.created_at DESC, ss.position ASC`
    );
    return rows.map((row: any) => ({
      server_id: row.server_id,
      owner_user_id: row.owner_user_id,
      server_name: row.server_name,
      sub_server_id: row.sub_server_id,
      name: row.sub_name,
      description: row.sub_description ?? "",
      tags: typeof row.tags === "string" ? JSON.parse(row.tags) : (row.tags ?? []),
      icon_url: row.icon_url ?? null,
      background_url: row.background_url ?? null,
      is_online: row.is_online === 1,
      player_count: Number(row.player_count),
      position: Number(row.position),
    }));
  }

  public async getServerById(id: string): Promise<ServerSettings | null> {
    const [rows]: any = await Mysql.getPool().query(
      `SELECT
        s.id, s.owner_user_id, s.name, s.description, s.tags,
        MAX(CASE WHEN sm.media_type = 'icon' THEN sm.url END) AS icon_url,
        MAX(CASE WHEN sm.media_type = 'background' THEN sm.url END) AS background_url
      FROM servers s
      LEFT JOIN server_media sm ON sm.server_id = s.id
      WHERE s.id = ?
      GROUP BY s.id`,
      [id]
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: row.id,
      owner_user_id: row.owner_user_id,
      name: row.name,
      description: row.description ?? "",
      tags: typeof row.tags === "string" ? JSON.parse(row.tags) : (row.tags ?? []),
      icon_url: row.icon_url ?? null,
      background_url: row.background_url ?? null,
    };
  }

  public async updateServer(
    id: string,
    name: string,
    description: string,
    tags: string[]
  ): Promise<void> {
    await Mysql.getPool().query(
      "UPDATE servers SET name = ?, description = ?, tags = ? WHERE id = ?",
      [name, description, JSON.stringify(tags), id]
    );
  }

  /**
   * 刪除伺服器媒體紀錄（從 server_media 表移除）
   *
   * @param serverId - 伺服器 ID
   * @param mediaType - "icon" 或 "background"
   */
  public async deleteServerMedia(
    serverId: string,
    mediaType: "icon" | "background"
  ): Promise<void> {
    await Mysql.getPool().query(
      "DELETE FROM server_media WHERE server_id = ? AND media_type = ?",
      [serverId, mediaType]
    );
  }

  public async upsertServerMedia(
    serverId: string,
    mediaType: "icon" | "background",
    url: string
  ): Promise<void> {
    await Mysql.getPool().query(
      `INSERT INTO server_media (server_id, media_type, url)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE url = VALUES(url)`,
      [serverId, mediaType, url]
    );
  }
}