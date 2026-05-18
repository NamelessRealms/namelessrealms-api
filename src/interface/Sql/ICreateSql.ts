/**
 * @file ICreateSql.ts
 * @description 定義資料庫寫入操作的回傳介面，表示資料是否有被實際修改
 */
export default interface ICreateSql {
    modified: boolean;
}
