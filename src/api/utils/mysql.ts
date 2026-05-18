/**
 * @file mysql.ts
 * @description MySQL 連線池的靜態包裝器，在應用程式啟動時建立連線並提供全域存取
 * @methods
 *   - connect: 建立 mysql2 連線池
 *   - getPool: 取得連線池實例（未連線時拋出例外）
 * @dependencies mysql2/promise, config.service
 */
import { createPool, Pool } from "mysql2/promise";
import Logs from "./logs";
import { config } from "../../config/config.service";

export default class Mysql {
  public static mysqlPool: Pool | undefined;

  public static connect(): void {
    this.mysqlPool = createPool({
      host: config.db.host,
      user: config.db.user,
      password: config.db.pass,
      database: config.db.name,
      connectionLimit: 10,
    });
    // Logs.info(`Success connect Database: ${config.db.name}`);
  }

  public static getPool(): Pool {
    if (this.mysqlPool === undefined) {
      throw new Error("沒有 mysql 連接");
    }

    return this.mysqlPool as Pool;
  }
}
