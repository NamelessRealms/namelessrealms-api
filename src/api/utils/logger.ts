/**
 * @file logger.ts
 * @description pino logger 單例，開發模式輸出 pino-pretty 彩色格式，正式模式輸出 JSON
 * @dependencies pino, config.service
 */
import pino from "pino";
import { config } from "../../config/config.service";

const logger = pino({
  level: config.isDevelopment ? "debug" : "info",
  transport: config.isDevelopment
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "yyyy-mm-dd HH:MM:ss",
          ignore: "pid,hostname",
        },
      }
    : undefined,
});

export default logger;
