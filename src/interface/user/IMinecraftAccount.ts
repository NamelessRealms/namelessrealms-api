/**
 * @file IMinecraftAccount.ts
 * @description 已連結 Minecraft 帳號的資料介面，對應資料庫 minecraft_accounts 表
 */
export default interface IMinecraftAccount {
    user_id: string;
    minecraft_uuid: string;
    minecraft_username: string;
    linked_at?: Date;
}
