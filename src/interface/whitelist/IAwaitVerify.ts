/**
 * @file IAwaitVerify.ts
 * @description 待驗證白名單資料介面，對應資料庫 awaitVerify_whitelist 表
 */
export default interface IAwaitVerify {
    timestamp: string;
    server_id: string;
    minecraft_id: string;
    discord_id: string;
    consent_rules: boolean;
}