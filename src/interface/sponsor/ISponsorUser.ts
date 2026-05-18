/**
 * @file ISponsorUser.ts
 * @description 贊助者資料介面，對應資料庫 sponsor_userlist 表
 */
export default interface ISponsorUser {
    minecraft_uuid: string;
    money: string;
}