/**
 * @file testApp.ts
 * @description 測試用 Express app 工廠：建立不含 DB 連線與 Socket.IO 的最小 app，
 *              僅掛載傳入的 route class 與全域 errorMiddleware，供 supertest 做端點契約測試
 * @methods createTestApp - 以一或多個 route class 組裝測試 app
 * @notes 刻意不呼叫 App._init（Mysql.connect / loop 服務），故路由背後的 service 需自行 mock
 */
import express, { Application } from "express";
import { errorMiddleware } from "../../src/api/middlewares/error.middleware";

/** route class 的建構式型別：接受 Express app 並於建構時自我註冊路由。 */
type RouteClass = new (app: Application) => unknown;

/**
 * 組裝測試用 Express app。
 *
 * 鏡像正式 App 的請求解析中介層（json / urlencoded），掛載傳入的 route class，
 * 最後接上全域 errorMiddleware，使錯誤格式與正式環境一致。
 */
export function createTestApp(...routeClasses: RouteClass[]): Application {
  const app = express();
  app.use(express.json({ limit: "10MB" }));
  app.use(express.urlencoded({ extended: true }));

  for (const RouteClass of routeClasses) {
    new RouteClass(app);
  }

  app.use(errorMiddleware);
  return app;
}
