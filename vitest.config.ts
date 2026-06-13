/**
 * @file vitest.config.ts
 * @description Vitest 設定：node 環境執行端點契約測試，並在載入任何模組前注入測試用環境變數
 * @notes config.service 於 import 時即驗證必要 env，缺少會直接拋例外，故必須在此預先注入 dummy 值
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // 在任何模組載入前注入，滿足 config.service 的必要變數驗證（不連線真實 DB）。
    // environment.ts 僅認得 development/production；用 development 取得常數，路由測試不外連。
    env: {
      NODE_ENV: "development",
      MYSQL_HOST: "localhost",
      MYSQL_USER: "test",
      MYSQL_PASSWORD: "test",
      MYSQL_DATABASE: "test",
      JWT_SECRET: "test-secret",
      JWT_REFRESH_SECRET: "test-refresh-secret",
      JWT_SALT: "test-salt",
    },
  },
});
