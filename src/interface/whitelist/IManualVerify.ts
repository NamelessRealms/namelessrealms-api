/**
 * @file IManualVerify.ts
 * @description 人工驗證白名單資料介面，對應資料庫 manualVerify_whitelist 表
 */
export default interface IManualVerify {
    minecraft_uuid: string;
    minecraft_id: string;
    discord_user_name: string;
    discord_user_id: string;
    channel_id: string;
    message_id: string;
    server_id: string;
}