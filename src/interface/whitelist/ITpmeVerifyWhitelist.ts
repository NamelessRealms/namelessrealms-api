/**
 * @file ITpmeVerifyWhitelist.ts
 * @description TPME 驗證白名單資料介面，對應資料庫 tpme_verify_whitelist 表
 */
export default interface TpmeVerifyWhitelist {
    minecraft_name: string;
    minecraft_uuid: string;
    discord_user_name: string;
    discord_user_id: string;
    server_Id: string;
}