/**
 * @file error.middleware.test.ts
 * @description 全域錯誤中介層契約測試：AppError 應依其 statusCode/code 格式化，未預期錯誤一律 500
 */
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { errorMiddleware } from "../../src/api/middlewares/error.middleware";
import { AppError } from "../../src/api/utils/response/AppError";

/** 組一個會在指定路由拋出給定錯誤的最小 app。 */
function appThatThrows(error: unknown) {
  const app = express();
  app.get("/boom", (_req, _res, next) => next(error));
  app.use(errorMiddleware);
  return app;
}

describe("errorMiddleware", () => {
  it("AppError 以其 statusCode 與 code 回應", async () => {
    const app = appThatThrows(new AppError("壞掉了", 403, "Forbidden"));
    const res = await request(app).get("/boom");

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      success: false,
      code: "Forbidden",
      message: "壞掉了",
      isOperational: true,
    });
  });

  it("未預期錯誤一律回應 500 與 UnknownError", async () => {
    const app = appThatThrows(new Error("非預期"));
    const res = await request(app).get("/boom");

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ success: false, code: "UnknownError" });
  });
});
