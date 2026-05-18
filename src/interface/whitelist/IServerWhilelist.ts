/**
 * @file IServerWhilelist.ts
 * @description 伺服器白名單資料介面，對應資料庫 server_whitelist 表
 */
export default interface IServerWhilelist {
    minecraft_uuid: string;
    server_id: string;
}