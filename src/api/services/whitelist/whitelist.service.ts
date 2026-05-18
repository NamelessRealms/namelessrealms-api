/**
 * @file whitelist.service.ts
 * @description 白名單系統的資料庫操作層，管理待驗證、人工驗證、伺服器白名單與 TPME 驗證四種清單
 * @methods
 *   - createAwaitVerify / getAwaitVerify / deleteAwaitVerify: 待驗證白名單 CRUD
 *   - getAllManualVerify / createManualVerify / getManualVerify / getManualVerifyCIdMId / deleteManualVerify: 人工驗證 CRUD
 *   - getAllServerWhitelist / createServerWhitelist / getServerWhitelist / getServerWhitelistServerId / deleteServerWhitelist: 伺服器白名單 CRUD
 *   - createTpmeVerifyWhitelist / getAllTpmeVerifyWhitelist / deleteTpmeVerifyWhitelist: TPME 驗證 CRUD
 * @dependencies mysql, Sql utility
 */
import ICreateSql from "../../../interface/Sql/ICreateSql";
import IAwaitVerify from "../../../interface/whitelist/IAwaitVerify";
import IManualVerify from "../../../interface/whitelist/IManualVerify";
import IServerWhilelist from "../../../interface/whitelist/IServerWhilelist";
import TpmeVerifyWhitelist from "../../../interface/whitelist/ITpmeVerifyWhitelist";
import Sql from "../../utils/database/sql";
import Mysql from "../../utils/mysql";

export default class WhitelistService {

    public async createAwaitVerify(requestBody: IAwaitVerify | IAwaitVerify[]): Promise<ICreateSql> {

        const createSqlDataMethod = async (body: IAwaitVerify): Promise<ICreateSql> => {

            const awaitVerifyData = await Mysql.getPool().query("SELECT * FROM awaitVerify_whitelist WHERE discord_id = ?", [body.discord_id]);
            const isData = (awaitVerifyData[0] as Array<IAwaitVerify>).length === 0;

            if (isData) {
                await Mysql.getPool().query("INSERT INTO awaitVerify_whitelist SET ?", [body]);
            }

            return {
                modified: isData
            };
        }

        const { modified } = await Sql.createSqlData(requestBody, createSqlDataMethod);
        return {
            modified: modified
        };
    }

    public async getAwaitVerify(discordId: string): Promise<any> {
        const awaitVerifyData = await Mysql.getPool().query("SELECT * FROM awaitVerify_whitelist WHERE discord_id = ?", [discordId]);
        return (awaitVerifyData[0] as Array<any>)[0];
    }

    public async deleteAwaitVerify(discordId: string): Promise<void> {
        await Mysql.getPool().query("DELETE FROM awaitVerify_whitelist WHERE discord_id = ?", [discordId]);
    }

    public async getAllManualVerify(): Promise<any> {
        const allManualVerifyData = await Mysql.getPool().query("SELECT * FROM manualVerify_whitelist");
        return allManualVerifyData[0];
    }

    public async createManualVerify(requestBody: IManualVerify | IManualVerify[]): Promise<{ modified: boolean }> {

        const createSqlDataMethod = async (body: IManualVerify): Promise<{ modified: boolean }> => {

            const awaitVerifyData = await Mysql.getPool().query("SELECT * FROM manualVerify_whitelist WHERE discord_user_id = ?", [body.discord_user_id]);
            const isData = (awaitVerifyData[0] as Array<IManualVerify>).length === 0;

            if (isData) {
                await Mysql.getPool().query("INSERT INTO manualVerify_whitelist SET ?", [body]);
            }

            return {
                modified: isData
            };
        }

        const { modified } = await Sql.createSqlData(requestBody, createSqlDataMethod);
        return {
            modified: modified
        };
    }

    public async getManualVerify(discordUserId: string): Promise<any> {
        const manualVerifyData = await Mysql.getPool().query("SELECT * FROM manualVerify_whitelist WHERE discord_user_id = ?", [discordUserId]);
        return (manualVerifyData[0] as Array<any>)[0];
    }

    public async getManualVerifyCIdMId(channelId: string, messageId: string): Promise<any> {
        const manualVerifyData = await Mysql.getPool().query("SELECT * FROM manualVerify_whitelist WHERE channel_id = ? AND message_id = ?", [channelId, messageId]);
        return (manualVerifyData[0] as Array<any>)[0];
    }

    public async deleteManualVerify(channelId: string, messageId: string): Promise<void> {
        await Mysql.getPool().query("DELETE FROM manualVerify_whitelist WHERE channel_id = ? AND message_id = ?", [channelId, messageId]);
    }

    public async getAllServerWhitelist(): Promise<Array<any>> {
        const allServerWhitelistData = await Mysql.getPool().query("SELECT * FROM server_whitelist");
        return (allServerWhitelistData[0] as Array<any>);
    }

    public async createServerWhitelist(requestBody: IServerWhilelist | IServerWhilelist[]): Promise<{ modified: boolean }> {

        const createSqlDataMethod = async (body: IServerWhilelist): Promise<{ modified: boolean }> => {

            const serverWhitelistData = await Mysql.getPool().query("SELECT * FROM server_whitelist WHERE minecraft_uuid = ? AND server_id = ?", [body.minecraft_uuid, body.server_id]);
            const isData = (serverWhitelistData[0] as Array<IServerWhilelist>).length === 0;

            if (isData) {
                await Mysql.getPool().query("INSERT INTO server_whitelist SET ?", [body]);
            }

            return {
                modified: isData
            };
        }

        const { modified } = await Sql.createSqlData(requestBody, createSqlDataMethod);
        return {
            modified: modified
        };
    }

    public async getServerWhitelist(minecraftUUID: string): Promise<any> {
        const serverWhitelistData = await Mysql.getPool().query("SELECT * FROM server_whitelist WHERE minecraft_uuid = ?", [minecraftUUID]);
        return (serverWhitelistData[0] as Array<any>);
    }

    public async getServerWhitelistServerId(minecraftUUID: string, serverId: string): Promise<any> {
        const serverWhitelistData = await Mysql.getPool().query("SELECT * FROM server_whitelist WHERE minecraft_uuid = ? AND server_id = ?", [minecraftUUID, serverId]);
        return (serverWhitelistData[0] as Array<any>)[0];
    }

    public async deleteServerWhitelist(minecraftUUID: string): Promise<void> {
        await Mysql.getPool().query("DELETE FROM server_whitelist WHERE minecraft_uuid = ?", [minecraftUUID]);;
    }

    public async createTpmeVerifyWhitelist(requestBody: TpmeVerifyWhitelist | TpmeVerifyWhitelist[]): Promise<ICreateSql> {

        const createSqlDataMethod = async (body: TpmeVerifyWhitelist): Promise<ICreateSql> => {

            const tpmeVerifyWhitelistData = await Mysql.getPool().query("SELECT * FROM tpme_verify_whitelist WHERE discord_user_id = ?", [body.discord_user_id]);
            const isData = (tpmeVerifyWhitelistData[0] as Array<TpmeVerifyWhitelist>).length === 0;

            if (isData) {
                await Mysql.getPool().query("INSERT INTO tpme_verify_whitelist SET ?", [body]);
            }

            return {
                modified: isData
            };
        }

        const { modified } = await Sql.createSqlData(requestBody, createSqlDataMethod);
        return {
            modified: modified
        };
    }

    public async getAllTpmeVerifyWhitelist(): Promise<Array<any>> {
        const tempVerifyWhitelistData = await Mysql.getPool().query("SELECT * FROM tpme_verify_whitelist");
        return tempVerifyWhitelistData[0] as Array<any>;
    }

    public async deleteTpmeVerifyWhitelist(discordUserId: string): Promise<void> {
        await Mysql.getPool().query("DELETE FROM tpme_verify_whitelist WHERE discord_user_id = ?", [discordUserId]);
    }
}
