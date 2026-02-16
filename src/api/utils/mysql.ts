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
