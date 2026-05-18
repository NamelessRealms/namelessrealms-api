/**
 * @file IUser.ts
 * @description 資料庫 users 表的使用者資料介面
 */
export interface IUser {
    id: number;
    unique: string;
    username: string;
    password: string;
    roles: Array<string>;
}