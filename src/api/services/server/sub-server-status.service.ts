/**
 * @file sub-server-status.service.ts
 * @description 定期以 Server List Ping 探測所有子伺服器，將線上狀態與人數寫回 server_sub_servers
 * @methods
 *   - initStatusLoop: 啟動時立即探測一次，之後每 PING_INTERVAL_MS 探測一輪
 *   - pingAll: 探測全部子伺服器（分批並發），更新 is_online / player_count
 * @dependencies utils/mysql, utils/logger, utils/minecraftServerPing
 * @notes 以 running 旗標避免上一輪未完成就重入；單台逾時 PING_TIMEOUT_MS
 */
import Mysql from "../../utils/mysql";
import logger from "../../utils/logger";
import { pingMinecraftServer } from "../../utils/minecraftServerPing";

/** 探測間隔（毫秒） */
const PING_INTERVAL_MS = 60_000;
/** 單台 ping 逾時（毫秒） */
const PING_TIMEOUT_MS = 3_000;
/** 同時並發探測的子伺服器數量上限 */
const PING_CONCURRENCY = 20;

interface SubServerEndpoint {
  id: string;
  host: string;
  port: number;
}

export default class SubServerStatusService {
  /** 避免上一輪尚未完成又被下一輪 interval 重入 */
  private static running = false;

  /** 啟動探測迴圈：立即跑一次，之後每 PING_INTERVAL_MS 一輪 */
  public static initStatusLoop(): void {
    SubServerStatusService.pingAll().catch((err) =>
      logger.error(err, "子伺服器狀態初次探測失敗"),
    );
    setInterval(() => {
      SubServerStatusService.pingAll().catch((err) =>
        logger.error(err, "子伺服器狀態探測失敗"),
      );
    }, PING_INTERVAL_MS);
  }

  /** 探測所有子伺服器並更新狀態（分批並發，避免一次開太多 socket） */
  public static async pingAll(): Promise<void> {
    if (SubServerStatusService.running) return;
    SubServerStatusService.running = true;
    try {
      const [rows]: any = await Mysql.getPool().query(
        "SELECT id, host, port FROM server_sub_servers",
      );
      const subServers = rows as SubServerEndpoint[];

      for (let i = 0; i < subServers.length; i += PING_CONCURRENCY) {
        const batch = subServers.slice(i, i + PING_CONCURRENCY);
        await Promise.all(batch.map((sub) => SubServerStatusService._pingAndUpdate(sub)));
      }
    } finally {
      SubServerStatusService.running = false;
    }
  }

  /** 探測單台並把結果寫回 DB（連不上即視為離線、人數歸零） */
  private static async _pingAndUpdate(sub: SubServerEndpoint): Promise<void> {
    const result = await pingMinecraftServer(sub.host, Number(sub.port), PING_TIMEOUT_MS);
    const isOnline = result !== null;
    const playerCount = result?.online ?? 0;

    await Mysql.getPool().query(
      "UPDATE server_sub_servers SET is_online = ?, player_count = ? WHERE id = ?",
      [isOnline ? 1 : 0, playerCount, sub.id],
    );
  }
}
