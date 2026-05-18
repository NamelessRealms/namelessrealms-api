/**
 * @file IUserLink.ts
 * @description Minecraft-Discord 帳號連結資料介面，對應資料庫 user_link 表
 */
export default interface IUserLink {
    minecraft_uuid: string;
    discord_id: string;
}