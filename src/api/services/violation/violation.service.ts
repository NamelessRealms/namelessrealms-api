/**
 * @file violation.service.ts
 * @description 違規使用者查詢的資料庫操作層
 * @methods
 *   - getViolationUser: 依 Minecraft UUID 或 Discord ID 查詢違規紀錄
 * @dependencies mysql
 */
import Mysql from "../../utils/mysql";

export default class ViolationService {

    public async getViolationUser(id: string): Promise<Array<any>> {
        const allViolationUserData = await Mysql.getPool().query("SELECT * FROM violationlist WHERE minecraft_uuid = ? OR discord_id = ?", [id, id]);
        return (allViolationUserData[0] as Array<any>);
    }
}
