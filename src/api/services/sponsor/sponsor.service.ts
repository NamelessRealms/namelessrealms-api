/**
 * @file sponsor.service.ts
 * @description 贊助者紀錄的資料庫操作層，支援查詢、新增、累加金額與刪除
 * @methods
 *   - getAllSponsorUser: 取得所有贊助者
 *   - createSponsorUser: 新增贊助者（支援單筆或陣列）
 *   - patchSponsorUser: 累加贊助金額（非覆蓋）
 *   - deleteSponsorUser: 刪除贊助紀錄
 *   - getSponsorUser: 依 UUID 查詢贊助者
 * @dependencies mysql, Sql utility
 */
import ISponsorUser from "../../../interface/sponsor/ISponsorUser";
import ICreateSql from "../../../interface/Sql/ICreateSql";
import Sql from "../../utils/database/sql";
import Mysql from "../../utils/mysql";

export default class SponsorService {

    public async getAllSponsorUser(): Promise<Array<any>> {
        const sponsorUserListData = await Mysql.getPool().query("SELECT * FROM sponsor_userlist");
        return (sponsorUserListData[0] as Array<any>);
    }

    public async createSponsorUser(requestBody: ISponsorUser | ISponsorUser[]): Promise<ICreateSql> {

        const createSqlDataMethod = async (body: ISponsorUser): Promise<ICreateSql> => {

            const sponsorUserListData = await Mysql.getPool().query("SELECT * FROM sponsor_userlist WHERE minecraft_uuid = ?", [body.minecraft_uuid]);
            const isData = (sponsorUserListData[0] as Array<ISponsorUser>).length === 0;

            if (isData) {
                await Mysql.getPool().query("INSERT INTO sponsor_userlist SET ?", [body]);
            }

            return { modified: isData };
        }

        const { modified } = await Sql.createSqlData(requestBody, createSqlDataMethod);
        return { modified: modified };
    }

    public async patchSponsorUser(minecraftUUID: string, money: number): Promise<{ modified: boolean, info: { minecraft_uuid: string, money: number } }> {

        const sponsorUser = await Mysql.getPool().query("SELECT * FROM sponsor_userlist WHERE minecraft_uuid = ?", [minecraftUUID]);
        const isData = (sponsorUser[0] as Array<ISponsorUser>).length === 0;

        if (isData) {
            throw {
                error: "not_replace_data",
                error_description: "沒有可替換的資源，請先新增資源。"
            };
        }

        const addSum = Number((sponsorUser[0] as Array<ISponsorUser>)[0].money) + money;
        await Mysql.getPool().query("UPDATE sponsor_userlist SET money = ? WHERE minecraft_uuid = ?", [addSum, minecraftUUID]);

        return {
            modified: true,
            info: {
                minecraft_uuid: minecraftUUID,
                money: addSum
            }
        }
    }

    public async deleteSponsorUser(minecraftUUID: string): Promise<void> {
        await Mysql.getPool().query("DELETE FROM sponsor_userlist WHERE minecraft_uuid = ?", [minecraftUUID]);
    }

    public async getSponsorUser(minecraftUUID: string): Promise<any> {
        const sponsorUserData = await Mysql.getPool().query("SELECT * FROM sponsor_userlist WHERE minecraft_uuid = ?", [minecraftUUID]);
        return (sponsorUserData[0] as Array<any>)[0];
    }
}
