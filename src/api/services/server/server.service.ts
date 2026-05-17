import Mysql from "../../utils/mysql";

export default class ServerService {
  public async isNameTaken(name: string): Promise<boolean> {
    const [rows]: any = await Mysql.getPool().query(
      "SELECT id FROM servers WHERE name = ? LIMIT 1",
      [name]
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
}
