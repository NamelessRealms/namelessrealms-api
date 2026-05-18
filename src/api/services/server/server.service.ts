/**
 * @file server.service.ts
 * @description 社群伺服器的資料庫操作層，含名稱衝突檢查、CRUD 與媒體 URL upsert
 * @methods
 *   - isNameTaken / isNameTakenByOther: 檢查伺服器名稱是否已被使用
 *   - createServer: 新增伺服器紀錄
 *   - getAllServers / getServerById: 查詢伺服器列表與單筆資料（包含媒體 URL）
 *   - updateServer: 更新伺服器基本資訊
 *   - upsertServerMedia: 以 ON DUPLICATE KEY UPDATE 更新 icon 或 background URL
 * @dependencies mysql2
 * @notes tags 欄位以 JSON 字串儲存於資料庫，讀取時自動反序列化
 */
import Mysql from "../../utils/mysql";

export interface ServerSettings {
  id: string;
  owner_user_id: string;
  name: string;
  description: string;
  tags: string[];
  icon_url: string | null;
  background_url: string | null;
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
    await Mysql.getPool().query(
      "INSERT INTO servers (id, name, description, tags, owner_user_id) VALUES (?, ?, ?, ?, ?)",
      [id, name, description, JSON.stringify(tags), ownerUserId]
    );
    return { id };
  }

  public async getAllServers(): Promise<ServerSettings[]> {
    const [rows]: any = await Mysql.getPool().query(
      `SELECT
        s.id, s.owner_user_id, s.name, s.description, s.tags,
        MAX(CASE WHEN sm.media_type = 'icon' THEN sm.url END) AS icon_url,
        MAX(CASE WHEN sm.media_type = 'background' THEN sm.url END) AS background_url
      FROM servers s
      LEFT JOIN server_media sm ON sm.server_id = s.id
      GROUP BY s.id
      ORDER BY s.created_at DESC`
    );
    return rows.map((row: any) => ({
      id: row.id,
      owner_user_id: row.owner_user_id,
      name: row.name,
      description: row.description ?? "",
      tags: typeof row.tags === "string" ? JSON.parse(row.tags) : (row.tags ?? []),
      icon_url: row.icon_url ?? null,
      background_url: row.background_url ?? null,
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